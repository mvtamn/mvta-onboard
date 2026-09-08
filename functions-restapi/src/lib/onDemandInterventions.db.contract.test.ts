import assert from "node:assert/strict";
import test from "node:test";
import { parseConnectionString, sql } from "./db";
import { INTERVENTION_CANDIDATE_QUERY } from "./onDemandInterventions";

// Runs the real candidate selection against a SQL Server (the CI contract
// job's container), importing the statement rather than restating it.
//
// This is the query the five-minute cadence rests on. It has to be narrow
// enough that running it every five minutes is affordable on a single B1
// worker - the previous loop spent two round trips on every active request,
// healthy or not - and wide enough that a request which has recovered is still
// seen, so its open intervention can be resolved. The freshness bound is the
// other half: a row nothing has confirmed since the last authoritative
// reconciliation is not evidence about now, and used to be excluded by an
// in-memory set of ids that only the hourly path could supply.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const SCHEMA = `
IF OBJECT_ID('dbo.OnDemandServiceQualityInterventions', 'U') IS NOT NULL DROP TABLE dbo.OnDemandServiceQualityInterventions;
IF OBJECT_ID('dbo.MonitoredOnDemandWaits', 'U') IS NOT NULL DROP TABLE dbo.MonitoredOnDemandWaits;
IF OBJECT_ID('dbo.OnDemandZoneServiceStandardOverrides', 'U') IS NOT NULL DROP TABLE dbo.OnDemandZoneServiceStandardOverrides;
IF OBJECT_ID('dbo.OnDemandServiceStandardPolicy', 'U') IS NOT NULL DROP TABLE dbo.OnDemandServiceStandardPolicy;

CREATE TABLE dbo.OnDemandServiceStandardPolicy (id INT NOT NULL PRIMARY KEY, default_minutes INT NOT NULL);
CREATE TABLE dbo.OnDemandZoneServiceStandardOverrides (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), external_location_id NVARCHAR(100) NOT NULL,
  minutes INT NOT NULL, revoked_at DATETIME2 NULL, effective_at DATETIME2 NOT NULL, expires_at DATETIME2 NOT NULL
);
CREATE TABLE dbo.MonitoredOnDemandWaits (
  trip_id NVARCHAR(100) NOT NULL PRIMARY KEY, zone_id NVARCHAR(100) NOT NULL,
  wait_started_at DATETIME2 NOT NULL, predicted_pickup_at DATETIME2 NULL,
  last_polled_at DATETIME2 NOT NULL, monitor_state NVARCHAR(20) NOT NULL
);
CREATE TABLE dbo.OnDemandServiceQualityInterventions (
  request_id NVARCHAR(100) NOT NULL PRIMARY KEY, status NVARCHAR(20) NOT NULL,
  projected_breach_count INT NOT NULL DEFAULT 0
);

INSERT INTO dbo.OnDemandServiceStandardPolicy (id, default_minutes) VALUES (1, 25);
-- zone-strict holds a ten-minute standard, so a wait that is unremarkable
-- under the default breaches here. The candidate filter has to read the
-- applicable standard, not the default.
INSERT INTO dbo.OnDemandZoneServiceStandardOverrides (external_location_id, minutes, effective_at, expires_at)
  VALUES ('zone-strict', 10, DATEADD(DAY, -1, SYSUTCDATETIME()), DATEADD(DAY, 1, SYSUTCDATETIME()));
`;

// waited/predicted are minutes; polledMinutesAgo sets last_polled_at.
const ROWS: {
  id: string; zone: string; waited: number; predicted: number | null;
  polledMinutesAgo: number; state?: string; intervention?: boolean; expect: boolean; why: string;
}[] = [
  { id: "healthy-untracked", zone: "zone-1", waited: -10, predicted: 8, polledMinutesAgo: 1, expect: false, why: "healthy with nothing on file needs no decision" },
  { id: "healthy-with-intervention", zone: "zone-1", waited: -10, predicted: 8, polledMinutesAgo: 1, intervention: true, expect: true, why: "recovered, so its open intervention must be resolvable" },
  { id: "observed-breach", zone: "zone-1", waited: 30, predicted: 35, polledMinutesAgo: 1, expect: true, why: "past the standard now" },
  { id: "projected-breach", zone: "zone-1", waited: -5, predicted: 30, polledMinutesAgo: 1, expect: true, why: "forecast past the standard" },
  { id: "overdue-but-inside", zone: "zone-1", waited: 3, predicted: 8, polledMinutesAgo: 1, expect: false, why: "overdue is a watch condition, not an intervention" },
  { id: "strict-zone-breach", zone: "zone-strict", waited: 12, predicted: 14, polledMinutesAgo: 1, expect: true, why: "past a ten-minute override, inside the default" },
  { id: "stale-breach", zone: "zone-1", waited: 30, predicted: 35, polledMinutesAgo: 180, expect: false, why: "nothing has confirmed this since the last reconciliation" },
  { id: "completed-breach", zone: "zone-1", waited: 30, predicted: 35, polledMinutesAgo: 1, state: "completed", expect: false, why: "no longer active" },
  { id: "no-forecast-healthy", zone: "zone-1", waited: -10, predicted: null, polledMinutesAgo: 1, expect: false, why: "a missing forecast is not a breach" },
];

test("intervention candidates are the ones needing a decision, and only fresh ones", { skip: !connectionString }, async () => {
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
        .input("polled", sql.Int, row.polledMinutesAgo)
        .input("state", sql.NVarChar(20), row.state ?? "active")
        .query(`
          INSERT INTO dbo.MonitoredOnDemandWaits (trip_id, zone_id, wait_started_at, predicted_pickup_at, last_polled_at, monitor_state)
          VALUES (@id, @zone, DATEADD(MINUTE, -@waited, SYSUTCDATETIME()),
            CASE WHEN @predicted IS NULL THEN NULL ELSE DATEADD(MINUTE, @predicted - @waited, SYSUTCDATETIME()) END,
            DATEADD(MINUTE, -@polled, SYSUTCDATETIME()), @state);
        `);
      if (row.intervention) {
        await pool.request().input("id", sql.NVarChar(100), row.id).query(`
          INSERT INTO dbo.OnDemandServiceQualityInterventions (request_id, status) VALUES (@id, 'open');
        `);
      }
    }

    // Stands in for the last authoritative reconciliation, an hour ago.
    const selected = await pool.request()
      .input("covered_since", sql.DateTime2, new Date(Date.now() - 60 * 60_000))
      .query<{ request_id: string }>(INTERVENTION_CANDIDATE_QUERY);

    const returned = new Set(selected.recordset.map((row) => row.request_id));
    for (const row of ROWS) {
      assert.equal(returned.has(row.id), row.expect, `${row.id} (${row.why})`);
    }

    // The applicable standard travelled with the row, not the default.
    const strict = selected.recordset.find((row) => row.request_id === "strict-zone-breach") as unknown as { service_standard_minutes: number };
    assert.equal(strict.service_standard_minutes, 10);
  } finally {
    await pool.close();
  }
});
