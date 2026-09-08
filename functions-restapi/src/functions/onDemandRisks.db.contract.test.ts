import assert from "node:assert/strict";
import test from "node:test";
import { parseConnectionString, sql } from "../lib/db";
import { MONITORED_COUNT_QUERY, ON_DEMAND_RISK_QUERY } from "./onDemandRisks";

// Runs the real /on-demand-risks statements against a SQL Server (the CI
// contract job's container). The query is imported rather than restated: a
// test that rewrites the SQL proves only that the rewrite agrees with itself,
// and this is exactly the kind of predicate that drifts.
//
// What is being pinned: the endpoint returns risks, not every monitored
// request. Until 2026-09-07 it filtered on monitor_state alone, so a request
// well inside its standard appeared under a heading reading "Immediate
// attention - Wait-time exceptions". Each row below is one branch of the
// console's `waitState`, and the expectation is the set that is not "Within
// standard".
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const SCHEMA = `
IF OBJECT_ID('dbo.MonitoredOnDemandWaits', 'U') IS NOT NULL DROP TABLE dbo.MonitoredOnDemandWaits;
IF OBJECT_ID('dbo.OnDemandServiceQualityInterventions', 'U') IS NOT NULL DROP TABLE dbo.OnDemandServiceQualityInterventions;
IF OBJECT_ID('dbo.OnDemandZoneServiceStandardOverrides', 'U') IS NOT NULL DROP TABLE dbo.OnDemandZoneServiceStandardOverrides;
IF OBJECT_ID('dbo.OnDemandServiceStandardPolicy', 'U') IS NOT NULL DROP TABLE dbo.OnDemandServiceStandardPolicy;
IF OBJECT_ID('dbo.OnDemandOperationalZones', 'U') IS NOT NULL DROP TABLE dbo.OnDemandOperationalZones;
IF OBJECT_ID('dbo.OnDemandOperationalZoneVersions', 'U') IS NOT NULL DROP TABLE dbo.OnDemandOperationalZoneVersions;

CREATE TABLE dbo.OnDemandOperationalZoneVersions (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, feed_version NVARCHAR(200) NOT NULL, is_active BIT NOT NULL DEFAULT 0
);
CREATE TABLE dbo.OnDemandOperationalZones (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  zone_version_id UNIQUEIDENTIFIER NOT NULL, external_location_id NVARCHAR(100) NOT NULL, name NVARCHAR(200) NOT NULL
);
CREATE TABLE dbo.OnDemandServiceStandardPolicy (id INT NOT NULL PRIMARY KEY, default_minutes INT NOT NULL);
CREATE TABLE dbo.OnDemandZoneServiceStandardOverrides (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), external_location_id NVARCHAR(100) NOT NULL,
  minutes INT NOT NULL, revoked_at DATETIME2 NULL, effective_at DATETIME2 NOT NULL, expires_at DATETIME2 NOT NULL
);
CREATE TABLE dbo.OnDemandServiceQualityInterventions (
  request_id NVARCHAR(100) NOT NULL PRIMARY KEY, status NVARCHAR(20) NOT NULL
);
CREATE TABLE dbo.MonitoredOnDemandWaits (
  trip_id NVARCHAR(100) NOT NULL PRIMARY KEY, external_trip_id NVARCHAR(100) NULL, zone_id NVARCHAR(100) NOT NULL,
  wait_started_at DATETIME2 NOT NULL, predicted_pickup_at DATETIME2 NULL, assigned_vehicle_id NVARCHAR(64) NULL,
  stops_ahead INT NULL, accessible_vehicle_required BIT NOT NULL DEFAULT 0, eligible_vehicles_in_zone INT NULL,
  nearest_vehicle_context NVARCHAR(200) NULL, trend NVARCHAR(20) NOT NULL DEFAULT 'stable',
  prediction_confidence NVARCHAR(10) NULL, prediction_reasons NVARCHAR(MAX) NULL, source_updated_at DATETIME2 NULL,
  last_polled_at DATETIME2 NOT NULL, suggested_alert_id NVARCHAR(100) NULL,
  monitor_state NVARCHAR(20) NOT NULL, zone_resolution NVARCHAR(40) NULL
);

DECLARE @version UNIQUEIDENTIFIER = NEWID();
INSERT INTO dbo.OnDemandOperationalZoneVersions (id, feed_version, is_active) VALUES (@version, 'test', 1);
INSERT INTO dbo.OnDemandOperationalZones (zone_version_id, external_location_id, name)
  VALUES (@version, 'zone-1', 'Zone One'), (@version, 'zone-wide', 'Zone With A Wide Standard');
INSERT INTO dbo.OnDemandServiceStandardPolicy (id, default_minutes) VALUES (1, 25);
-- zone-wide carries a 40-minute standard, so its watch band and its breach
-- threshold are different numbers. A row that is a Watch there is well inside
-- the standard, which is the case a "standard minus five" rule got wrong.
INSERT INTO dbo.OnDemandZoneServiceStandardOverrides (external_location_id, minutes, effective_at, expires_at)
  VALUES ('zone-wide', 40, DATEADD(DAY, -1, SYSUTCDATETIME()), DATEADD(DAY, 1, SYSUTCDATETIME()));
`;

// waited/predicted are minutes relative to now; predicted null means no forecast.
const ROWS: { id: string; zone: string; waited: number; predicted: number | null; resolution: string | null; state?: string; expect: boolean; why: string }[] = [
  { id: "within-standard", zone: "zone-1", waited: -10, predicted: 8, resolution: "assigned", expect: false, why: "not due yet, forecast inside the watch band" },
  { id: "within-standard-no-forecast", zone: "zone-1", waited: -10, predicted: null, resolution: "assigned", expect: false, why: "no forecast falls back to nothing observed" },
  { id: "within-standard-null-zone", zone: "zone-1", waited: -10, predicted: 8, resolution: null, expect: false, why: "pre-zone-tracking rows are judged on their numbers" },
  { id: "watch-boundary-20", zone: "zone-1", waited: -10, predicted: 20, resolution: "assigned", expect: false, why: "20 is inside the band; the rule is above 20" },
  { id: "watch-boundary-21", zone: "zone-1", waited: -10, predicted: 21, resolution: "assigned", expect: true, why: "one minute past the watch threshold" },
  { id: "overdue", zone: "zone-1", waited: 3, predicted: 5, resolution: "assigned", expect: true, why: "pickup commitment has passed" },
  { id: "projected-risk", zone: "zone-1", waited: -5, predicted: 30, resolution: "assigned", expect: true, why: "forecast above the 25-minute standard" },
  { id: "standard-exceeded", zone: "zone-1", waited: 30, predicted: 35, resolution: "assigned", expect: true, why: "observed above the standard" },
  { id: "critical", zone: "zone-1", waited: 45, predicted: 50, resolution: "assigned", expect: true, why: "standard plus fifteen" },
  { id: "unzoned", zone: "zone-1", waited: -10, predicted: 8, resolution: "outside_operational_zones", expect: true, why: "cannot be judged, so it is not dismissed" },
  { id: "monitoring-incomplete", zone: "zone-1", waited: -10, predicted: 8, resolution: "legacy_unknown", expect: true, why: "same" },
  { id: "wide-zone-watch", zone: "zone-wide", waited: -10, predicted: 25, resolution: "assigned", expect: true, why: "past 20 though far inside a 40-minute standard" },
  { id: "wide-zone-quiet", zone: "zone-wide", waited: -10, predicted: 12, resolution: "assigned", expect: false, why: "inside both bounds" },
  { id: "completed", zone: "zone-1", waited: 30, predicted: 35, resolution: "assigned", state: "completed", expect: false, why: "no longer active" },
];

test("on-demand-risks returns exceptions, not every monitored request", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  const pool = new sql.ConnectionPool(parseConnectionString(connectionString));
  await pool.connect();
  try {
    await pool.request().batch(SCHEMA);
    for (const row of ROWS) {
      await pool.request()
        .input("id", sql.NVarChar(100), row.id)
        .input("zone", sql.NVarChar(100), row.zone)
        .input("waited", sql.Int, row.waited)
        .input("predicted", sql.Int, row.predicted)
        .input("resolution", sql.NVarChar(40), row.resolution)
        .input("state", sql.NVarChar(20), row.state ?? "active")
        .query(`
          INSERT INTO dbo.MonitoredOnDemandWaits
            (trip_id, zone_id, wait_started_at, predicted_pickup_at, last_polled_at, monitor_state, zone_resolution)
          VALUES (@id, @zone, DATEADD(MINUTE, -@waited, SYSUTCDATETIME()),
            CASE WHEN @predicted IS NULL THEN NULL
              ELSE DATEADD(MINUTE, @predicted - @waited, SYSUTCDATETIME()) END,
            SYSUTCDATETIME(), @state, @resolution);
        `);
    }

    const risks = await pool.request()
      .input("show_last_known", sql.Bit, false)
      .input("reconciled_at", sql.DateTime2, null)
      .input("watch_minutes", sql.Int, 20)
      .input("critical_margin", sql.Int, 15)
      .query<{ request_id: string }>(ON_DEMAND_RISK_QUERY);

    const returned = new Set(risks.recordset.map((row) => row.request_id));
    for (const row of ROWS) {
      assert.equal(returned.has(row.id), row.expect, `${row.id} (${row.why})`);
    }

    // Critical first, unjudgeable last: the cap of 250 must never spend itself
    // on rows nobody needs to see first.
    const order = risks.recordset.map((row) => row.request_id);
    assert.equal(order[0], "critical");
    assert.ok(
      order.indexOf("unzoned") > order.indexOf("watch-boundary-21"),
      `unzoned rows sort after judgeable ones: ${order.join(", ")}`,
    );

    // The population the list was drawn from: every active row, including the
    // ones the risk filter removed, and excluding the completed one.
    const monitored = await pool.request()
      .input("show_last_known", sql.Bit, false)
      .input("reconciled_at", sql.DateTime2, null)
      .query<{ monitored_request_count: number }>(MONITORED_COUNT_QUERY);
    assert.equal(monitored.recordset[0].monitored_request_count, ROWS.filter((row) => !row.state).length);
    assert.ok(returned.size < monitored.recordset[0].monitored_request_count);
  } finally {
    await pool.close();
  }
});
