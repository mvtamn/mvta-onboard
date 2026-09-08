import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  fixedRouteDepartureSourceRefSql,
  onDemandDepartureSourceRefSql,
  settledServiceDateExclusive,
} from "../functions/complianceCandidatesPoll";
import { parseConnectionString, sql } from "./db";

// Runs migration 105 against a real SQL Server (the CI contract job's
// container) and reads the five reporting views back.
//
// A view is the one kind of SQL in this repo that nothing else exercises: no
// endpoint selects from it, no poll writes through it, and the console never
// touches it. The first reader is Power BI, in another tool, after a gateway
// hop - which is the worst possible place to discover that a UNION ALL branch
// disagrees about a column type or that an exclusion joined on the wrong
// month. So the assertions below are about the three things a report would
// silently get wrong:
//
//   IsAssessable must reproduce resolveOtpFixedRoute's filter exactly, or the
//   drill-through disagrees with the scorecard above it.
//
//   SourceRef must be byte-identical to what complianceCandidatesPoll writes,
//   or the occurrence join is empty and every departure reads as compliant.
//   The poll's own expressions are imported and run against the same rows
//   rather than restated, so the two cannot drift apart.
//
//   The UNION ALL must actually carry both sources, with each source's
//   private columns NULL on the other side rather than mistyped.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

// Yesterday and today in agency-local terms: the settled/unsettled boundary
// the view computes with AT TIME ZONE, derived here the way the poll does.
const TODAY = settledServiceDateExclusive();
const YESTERDAY = settledServiceDateExclusive(new Date(Date.now() - 24 * 60 * 60 * 1000));
const MONTH = YESTERDAY.slice(0, 6);

const SCHEMA = `
IF OBJECT_ID('dbo.vw_GarageDeparture', 'V') IS NOT NULL DROP VIEW dbo.vw_GarageDeparture;
IF OBJECT_ID('dbo.vw_MissedTrip', 'V') IS NOT NULL DROP VIEW dbo.vw_MissedTrip;
IF OBJECT_ID('dbo.vw_OtpMonthlyRouteStop', 'V') IS NOT NULL DROP VIEW dbo.vw_OtpMonthlyRouteStop;
IF OBJECT_ID('dbo.vw_OtpDailyRouteStopHour', 'V') IS NOT NULL DROP VIEW dbo.vw_OtpDailyRouteStopHour;
IF OBJECT_ID('dbo.vw_MeasurementFeedHealth', 'V') IS NOT NULL DROP VIEW dbo.vw_MeasurementFeedHealth;
IF OBJECT_ID('dbo.OtpMonthlyRouteStopDay', 'U') IS NOT NULL DROP TABLE dbo.OtpMonthlyRouteStopDay;
IF OBJECT_ID('dbo.OtpDailyRouteStopHour', 'U') IS NOT NULL DROP TABLE dbo.OtpDailyRouteStopHour;
IF OBJECT_ID('dbo.OtpStopExclusions', 'U') IS NOT NULL DROP TABLE dbo.OtpStopExclusions;
IF OBJECT_ID('dbo.OtpReasonCodes', 'U') IS NOT NULL DROP TABLE dbo.OtpReasonCodes;
IF OBJECT_ID('dbo.RouteClassification', 'U') IS NOT NULL DROP TABLE dbo.RouteClassification;
IF OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
IF OBJECT_ID('dbo.FixedRouteDepartures', 'U') IS NOT NULL DROP TABLE dbo.FixedRouteDepartures;
IF OBJECT_ID('dbo.OnDemandDepartures', 'U') IS NOT NULL DROP TABLE dbo.OnDemandDepartures;
IF OBJECT_ID('dbo.ComplianceOccurrences', 'U') IS NOT NULL DROP TABLE dbo.ComplianceOccurrences;
IF OBJECT_ID('dbo.KpiFeedHealth', 'U') IS NOT NULL DROP TABLE dbo.KpiFeedHealth;

-- Column types match the migrations they come from; the views' UNION ALL and
-- date conversions are only meaningful against the real widths.
CREATE TABLE dbo.OtpMonthlyRouteStopDay (
  service_month CHAR(6) NOT NULL, route_id INT NOT NULL, stop_id INT NOT NULL, day_of_week NVARCHAR(20) NOT NULL,
  stop_name NVARCHAR(200) NULL, route_label NVARCHAR(100) NULL,
  pct_early FLOAT NULL, pct_ontime FLOAT NULL, pct_late FLOAT NULL, pct_not_ontime FLOAT NULL, pct_missed FLOAT NULL,
  early INT NULL, ontime INT NULL, late INT NULL, missed INT NULL, actual_departures INT NULL, total INT NULL,
  first_seen_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_OtpMonthlyRouteStopDay PRIMARY KEY (service_month, route_id, stop_id, day_of_week)
);
CREATE TABLE dbo.OtpDailyRouteStopHour (
  id BIGINT IDENTITY(1,1) PRIMARY KEY, calendar_date CHAR(8) NOT NULL, hour_of_day TINYINT NOT NULL,
  route_id INT NOT NULL, stop_id INT NOT NULL, stop_name NVARCHAR(200) NULL, route_label NVARCHAR(200) NULL,
  pct_early FLOAT NULL, pct_ontime FLOAT NULL, pct_late FLOAT NULL, pct_not_ontime FLOAT NULL, pct_missed FLOAT NULL,
  early INT NULL, ontime INT NULL, late INT NULL, missed INT NULL, actual_departures INT NULL, total INT NULL,
  latitude FLOAT NULL, longitude FLOAT NULL, direction NVARCHAR(20) NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.RouteClassification (
  route_id INT NOT NULL PRIMARY KEY, route_category NVARCHAR(20) NOT NULL, route_label NVARCHAR(100) NULL,
  is_active BIT NOT NULL DEFAULT 1, updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.OtpReasonCodes (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(), code NVARCHAR(30) NOT NULL, label NVARCHAR(100) NOT NULL,
  applies_to NVARCHAR(20) NOT NULL, is_active BIT NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 0,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.OtpStopExclusions (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(), service_month CHAR(6) NOT NULL, route_id INT NOT NULL,
  stop_id INT NOT NULL, day_of_week NVARCHAR(3) NOT NULL, status NVARCHAR(10) NOT NULL,
  reason_code NVARCHAR(30) NULL, reviewed_by NVARCHAR(200) NOT NULL,
  reviewed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, route_id NVARCHAR(50) NOT NULL,
  scheduled_departure_at DATETIME2 NOT NULL, grace_deadline_at DATETIME2 NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT 'escalated', detected_late_arrival_at DATETIME2 NULL,
  first_seen_watching_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  last_checked_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  validation_status NVARCHAR(20) NOT NULL DEFAULT 'unreviewed', validated_by NVARCHAR(200) NULL,
  validated_at DATETIME2 NULL, notes NVARCHAR(1000) NULL, detection_type NVARCHAR(30) NULL,
  reason_code NVARCHAR(30) NULL, detector_version NVARCHAR(30) NULL,
  data_quality_status NVARCHAR(30) NOT NULL DEFAULT 'legacy_unverified',
  source_system NVARCHAR(20) NOT NULL DEFAULT 'gtfs', source_record_id NVARCHAR(100) NULL,
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date)
);
CREATE TABLE dbo.FixedRouteDepartures (
  service_date CHAR(8) NOT NULL, block INT NOT NULL, run INT NOT NULL,
  checkin_scheduled DATETIME2 NULL, checkin_actual DATETIME2 NULL,
  login_scheduled DATETIME2 NULL, login_actual DATETIME2 NULL,
  pullout_scheduled DATETIME2 NULL, pullout_actual DATETIME2 NULL, pullout_status NVARCHAR(30) NULL,
  operator_name NVARCHAR(200) NULL, logon_id INT NULL, vehicle_label NVARCHAR(20) NULL,
  first_seen_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_FixedRouteDepartures PRIMARY KEY (service_date, block, run)
);
CREATE TABLE dbo.OnDemandDepartures (
  duty_id NVARCHAR(64) NOT NULL PRIMARY KEY, service_date CHAR(8) NOT NULL, duty_identifier NVARCHAR(64) NULL,
  driver_id NVARCHAR(64) NULL, vehicle_id NVARCHAR(64) NULL, duty_status NVARCHAR(32) NULL,
  departure_scheduled DATETIME2 NULL, scheduled_source NVARCHAR(32) NULL,
  departure_actual DATETIME2 NULL, departure_source NVARCHAR(32) NULL, slot_id NVARCHAR(64) NULL,
  source_updated_at DATETIME2 NULL, first_seen_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  vehicle_identifier NVARCHAR(64) NULL, driver_name NVARCHAR(128) NULL, driver_identifier NVARCHAR(64) NULL
);
CREATE TABLE dbo.ComplianceOccurrences (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), service_date CHAR(8) NOT NULL,
  description NVARCHAR(2000) NOT NULL, source NVARCHAR(30) NOT NULL, source_ref NVARCHAR(300) NULL,
  review_status NVARCHAR(20) NOT NULL DEFAULT 'candidate', attribution NVARCHAR(30) NOT NULL DEFAULT 'undetermined',
  dismiss_reason NVARCHAR(1000) NULL, created_by NVARCHAR(200) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.KpiFeedHealth (
  feed_name NVARCHAR(50) NOT NULL PRIMARY KEY, last_success_at DATETIME2 NULL, last_entity_count INT NULL,
  source_timestamp_at DATETIME2 NULL, coverage_start_at DATETIME2 NULL, coverage_end_at DATETIME2 NULL,
  last_failure_at DATETIME2 NULL, last_failure_reason NVARCHAR(1000) NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
`;

// One row per case the views have to get right, not a volume sample.
const SEED = `
INSERT INTO dbo.RouteClassification (route_id, route_category, route_label) VALUES
  (470, 'FixedRoute', 'Route 470'),
  (900, 'SpecialEvent', 'Vikings Game Shuttle');
INSERT INTO dbo.OtpReasonCodes (code, label, applies_to) VALUES
  ('LAYOVER', 'Recovery/layover stop', 'stop'),
  ('WEATHER', 'Weather/road conditions', 'missed_trip');
INSERT INTO dbo.OtpMonthlyRouteStopDay (service_month, route_id, stop_id, day_of_week, stop_name, route_label, ontime, total, pct_ontime) VALUES
  ('${MONTH}', 470, 1001, 'Mon', 'Cedar Grove', 'Route 470', 90, 100, 90.0),   -- classified fixed route, counts
  ('${MONTH}', 470, 1002, 'Mon', 'Layover Loop', 'Route 470', 10, 100, 10.0),  -- approved exclusion, does not count
  ('${MONTH}', 470, 1003, 'Mon', 'Disputed', 'Route 470', 20, 100, 20.0),      -- exclusion REJECTED, still counts
  ('${MONTH}', 471, 1004, 'Mon', 'Unclassified', 'Route 471', 80, 100, 80.0),  -- no classification row, counts
  ('${MONTH}', 900, 1005, 'Sat', 'Stadium', 'Shuttle', 0, 100, 0.0);           -- special event, does not count
INSERT INTO dbo.OtpStopExclusions (service_month, route_id, stop_id, day_of_week, status, reason_code, reviewed_by) VALUES
  ('${MONTH}', 470, 1002, 'Mon', 'approved', 'LAYOVER', 'planner@mvta.example'),
  ('${MONTH}', 470, 1003, 'Mon', 'rejected', 'LAYOVER', 'planner@mvta.example');
INSERT INTO dbo.OtpDailyRouteStopHour (calendar_date, hour_of_day, route_id, stop_id, ontime, total, direction) VALUES
  ('${YESTERDAY}', 7, 470, 1001, 9, 10, 'Northbound');

INSERT INTO dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at,
  validation_status, detection_type, data_quality_status, source_system, source_record_id, reason_code) VALUES
  ('trip-1', '${YESTERDAY}', '470', SYSUTCDATETIME(), SYSUTCDATETIME(), 'confirmed', 'silent_no_show', 'source_verified', 'gtfs', NULL, 'WEATHER'),
  ('trip-2', '${YESTERDAY}', '470', SYSUTCDATETIME(), SYSUTCDATETIME(), 'unreviewed', 'silent_no_show', 'unknown_data_gap', 'gtfs', NULL, NULL),
  ('duty-9', '${YESTERDAY}', '0',   SYSUTCDATETIME(), SYSUTCDATETIME(), 'confirmed', 'spare_late_start', 'source_verified', 'spare', 'req-9', NULL);

INSERT INTO dbo.FixedRouteDepartures (service_date, block, run, pullout_scheduled, pullout_actual, pullout_status, logon_id, vehicle_label, operator_name) VALUES
  ('${YESTERDAY}', 12, 3, '2026-09-06T11:00:00', '2026-09-06T11:15:00', 'Late Pullout', 4412, '801', 'Doe, Jane'),
  ('${YESTERDAY}', 12, 4, '2026-09-06T11:05:00', NULL,                  'Expired Pullout', 4413, '802', 'Roe, Rick'),
  ('${TODAY}',     12, 5, '2026-09-07T11:00:00', NULL,                  'Missed Login', 4414, '803', 'Poe, Pat');
INSERT INTO dbo.OnDemandDepartures (duty_id, service_date, duty_identifier, duty_status, departure_scheduled,
  scheduled_source, departure_actual, departure_source, slot_id, vehicle_identifier, driver_identifier, driver_name) VALUES
  ('duty-a', '${YESTERDAY}', 'AM-1', 'completed', '2026-09-06T12:00:00', 'slots_startLocation', '2026-09-06T12:20:00', 'slots_startLocation', 'slot-a', '1204', 'drv-7', 'Ann, Alice'),
  ('duty-b', '${YESTERDAY}', 'AM-2', 'cancelled', '2026-09-06T12:30:00', 'duties_startRequested', NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO dbo.ComplianceOccurrences (service_date, description, source, source_ref, review_status, attribution, created_by) VALUES
  ('${YESTERDAY}', 'Missed trip trip-1', 'auto_candidate', 'MonitoredMissedTrips:gtfs:trip-1|${YESTERDAY}', 'confirmed', 'contractor_error', 'complianceCandidatesPoll'),
  ('${YESTERDAY}', 'Missed trip duty-9', 'auto_candidate', 'MonitoredMissedTrips:spare:req-9|${YESTERDAY}', 'candidate', 'undetermined', 'complianceCandidatesPoll'),
  ('${YESTERDAY}', 'Garage departure Late Pullout', 'auto_candidate', 'FixedRouteDepartures:avail_pullout:${YESTERDAY}|12|3', 'confirmed', 'contractor_error', 'complianceCandidatesPoll'),
  ('${YESTERDAY}', 'Garage departure on-demand duty AM-1', 'auto_candidate', 'OnDemandDepartures:spare_duties:duty-a', 'dismissed', 'excusable', 'reviewer@mvta.example');

INSERT INTO dbo.KpiFeedHealth (feed_name, last_success_at, last_entity_count, last_failure_at, last_failure_reason) VALUES
  ('avail_otp_monthly', DATEADD(HOUR, -2, SYSUTCDATETIME()), 260, NULL, NULL),
  ('gtfs_vehicle_positions', DATEADD(HOUR, -9, SYSUTCDATETIME()), 0, DATEADD(HOUR, -1, SYSUTCDATETIME()), 'timeout');
`;

async function runMigration(pool: sql.ConnectionPool, file: string): Promise<void> {
  const script = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of script.split(/^\s*GO\s*$/m)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

test("migration 105 reporting views expose the raw OTP, missed-trip and garage-departure measurements", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  const pool = new sql.ConnectionPool(parseConnectionString(connectionString));
  await pool.connect();
  try {
    await pool.request().batch(SCHEMA);
    await pool.request().batch(SEED);
    await runMigration(pool, "migration-105-raw-measurement-reporting-views.sql");

    // --- OTP monthly: IsAssessable is resolveOtpFixedRoute's filter, per row.
    const otp = (await pool.request().query<{ StopId: number; IsAssessable: boolean; IsStopExcluded: boolean; ExclusionReasonLabel: string | null; RouteCategory: string; IsOfficialRecord: boolean }>(
      "SELECT StopId, IsAssessable, IsStopExcluded, ExclusionReasonLabel, RouteCategory, IsOfficialRecord FROM dbo.vw_OtpMonthlyRouteStop ORDER BY StopId",
    )).recordset;
    assert.deepEqual(
      otp.map((r) => [r.StopId, r.IsAssessable, r.IsStopExcluded]),
      [[1001, true, false], [1002, false, true], [1003, true, false], [1004, true, false], [1005, false, false]],
    );
    // A rejected exclusion is not an exclusion; an unclassified route is fixed route.
    assert.equal(otp.find((r) => r.StopId === 1003)?.IsStopExcluded, false);
    assert.equal(otp.find((r) => r.StopId === 1004)?.RouteCategory, "FixedRoute");
    assert.equal(otp.find((r) => r.StopId === 1002)?.ExclusionReasonLabel, "Recovery/layover stop");
    assert.ok(otp.every((r) => r.IsOfficialRecord === true));

    // Summing the assessable rows reproduces the assessed figure: 90+20+80 of
    // 300. The excluded and special-event stops would drag it to 200/500.
    const assessable = (await pool.request().query<{ OnTime: number; Total: number }>(
      "SELECT SUM(OnTimeDepartures) OnTime, SUM(TotalDepartures) Total FROM dbo.vw_OtpMonthlyRouteStop WHERE IsAssessable = 1",
    )).recordset[0];
    assert.deepEqual([assessable.OnTime, assessable.Total], [190, 300]);

    // --- OTP daily: trending, and it says so.
    const daily = (await pool.request().query<{ HourOfDay: number; HourStart: Date; IsOfficialRecord: boolean; RouteCategory: string }>(
      "SELECT HourOfDay, HourStart, IsOfficialRecord, RouteCategory FROM dbo.vw_OtpDailyRouteStopHour",
    )).recordset;
    assert.equal(daily.length, 1);
    assert.equal(daily[0].IsOfficialRecord, false);
    assert.equal(daily[0].HourStart.toISOString().slice(11, 16), "07:00");

    // --- Missed trips: both pipelines, and the occurrence each one raised.
    const missed = (await pool.request().query<{ TripId: string; ServiceType: string; IsConfirmed: boolean; DataQualityStatus: string; HasOccurrence: boolean; IsAssessed: boolean; ReasonLabel: string | null; ServiceDate: Date | null }>(
      "SELECT TripId, ServiceType, IsConfirmed, DataQualityStatus, HasOccurrence, IsAssessed, ReasonLabel, ServiceDate FROM dbo.vw_MissedTrip ORDER BY TripId",
    )).recordset;
    assert.deepEqual(
      missed.map((r) => [r.TripId, r.ServiceType, r.IsConfirmed, r.HasOccurrence, r.IsAssessed]),
      [["duty-9", "on_demand", true, true, false], ["trip-1", "fixed_route", true, true, true], ["trip-2", "fixed_route", false, false, false]],
    );
    // A feed outage is published as what it is, not counted as a missed trip.
    assert.equal(missed.find((r) => r.TripId === "trip-2")?.DataQualityStatus, "unknown_data_gap");
    assert.equal(missed.find((r) => r.TripId === "trip-1")?.ReasonLabel, "Weather/road conditions");
    assert.ok(missed.every((r) => r.ServiceDate instanceof Date));

    // --- Garage departures: one grain, two sources.
    const departures = (await pool.request().query<{ ServiceType: string; SourceSystem: string; DepartureLabel: string; Block: number | null; DutyId: string | null; DepartureDeltaSeconds: number | null; IsSettled: boolean; IsCandidate: boolean; IsAssessed: boolean; OccurrenceReviewStatus: string | null; ActualSource: string | null; SourceRef: string }>(
      "SELECT ServiceType, SourceSystem, DepartureLabel, Block, DutyId, DepartureDeltaSeconds, IsSettled, IsCandidate, IsAssessed, OccurrenceReviewStatus, ActualSource, SourceRef FROM dbo.vw_GarageDeparture ORDER BY SourceRef",
    )).recordset;
    assert.equal(departures.length, 5);
    const byLabel = Object.fromEntries(departures.map((r) => [r.DepartureLabel, r]));

    assert.equal(byLabel["Block 12 / run 3"].DepartureDeltaSeconds, 900);
    assert.equal(byLabel["Block 12 / run 3"].IsSettled, true);
    assert.equal(byLabel["Block 12 / run 3"].IsAssessed, true);
    assert.equal(byLabel["Block 12 / run 3"].DutyId, null);
    // No actual departure: a delta would be a fabricated number, so it is NULL.
    assert.equal(byLabel["Block 12 / run 4"].DepartureDeltaSeconds, null);
    // Today's run is not judged yet, and raised no occurrence.
    assert.equal(byLabel["Block 12 / run 5"].IsSettled, false);
    assert.equal(byLabel["Block 12 / run 5"].IsCandidate, false);

    assert.equal(byLabel["Duty AM-1"].ServiceType, "on_demand");
    assert.equal(byLabel["Duty AM-1"].DepartureDeltaSeconds, 1200);
    assert.equal(byLabel["Duty AM-1"].Block, null);
    assert.equal(byLabel["Duty AM-1"].ActualSource, "slots_startLocation");
    // Dismissed is raised but not assessed - the distinction a report needs.
    assert.equal(byLabel["Duty AM-1"].IsCandidate, true);
    assert.equal(byLabel["Duty AM-1"].IsAssessed, false);
    assert.equal(byLabel["Duty AM-1"].OccurrenceReviewStatus, "dismissed");
    assert.equal(byLabel["Duty AM-2"].IsCandidate, false);

    // No personal names anywhere in the departure view.
    const columns = (await pool.request().query<{ name: string }>(
      "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.vw_GarageDeparture')",
    )).recordset.map((r) => r.name);
    assert.ok(!columns.some((column) => /name$/i.test(column)), columns.join(","));

    // --- The occurrence join can only work if SourceRef is byte-identical to
    // what the candidate poll writes. Run the poll's own expressions.
    const refs = (await pool.request().query<{ ref: string }>(`
      SELECT ${fixedRouteDepartureSourceRefSql()} ref FROM dbo.FixedRouteDepartures d
      UNION ALL
      SELECT ${onDemandDepartureSourceRefSql()} ref FROM dbo.OnDemandDepartures d
    `)).recordset.map((r) => r.ref).sort();
    assert.deepEqual(departures.map((r) => r.SourceRef).sort(), refs);

    // --- Feed health.
    const health = (await pool.request().query<{ FeedName: string; LastRunFailed: boolean; StaleHours: number }>(
      "SELECT FeedName, LastRunFailed, StaleHours FROM dbo.vw_MeasurementFeedHealth ORDER BY FeedName",
    )).recordset;
    assert.deepEqual(health.map((r) => [r.FeedName, r.LastRunFailed]), [["avail_otp_monthly", false], ["gtfs_vehicle_positions", true]]);
    assert.ok(health[0].StaleHours >= 2 && health[0].StaleHours < 3);

    // Re-running the migration is a no-op (CREATE OR ALTER throughout).
    await runMigration(pool, "migration-105-raw-measurement-reporting-views.sql");
    const again = (await pool.request().query<{ n: number }>("SELECT COUNT(*) n FROM dbo.vw_GarageDeparture")).recordset[0].n;
    assert.equal(again, 5);
  } finally {
    await pool.request().batch(SCHEMA.split("CREATE TABLE")[0]).catch(() => undefined);
    await pool.close();
  }
});
