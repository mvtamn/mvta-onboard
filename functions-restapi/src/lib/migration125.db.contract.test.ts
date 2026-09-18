import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import { classifyMissedTripCase } from "./missedTripCase/classify";
import { promotionWindows, type DetectorPromotionEntry } from "./missedTripCase/promotion";

// Migration 125 against SQL Server, applied twice to tables in the shape
// migrations 011-121 left them (status columns NVARCHAR(20), with their CHECK
// and DEFAULT constraints): the columns widen, false_positive becomes Timely service once,
// with one note; the new columns and outcomes are accepted; and vw_MissedTrip
// keeps its columns and publishes the Missed-trip case module's classification
// exactly as classifyMissedTripCase computes it.
//
// Migration 134 is applied on top, because it regenerates the same view: the
// promotion history is created, the view still agrees with classifyMissedTripCase
// while nothing is promoted, and a promotion changes exactly the cases whose
// service date it covers.
//
// See subscriberResend.db.contract.test.ts on why the contract job runs one file
// at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.vw_MissedTrip','V') IS NOT NULL DROP VIEW dbo.vw_MissedTrip;
IF OBJECT_ID('dbo.MissedTripDetectorPromotions','U') IS NOT NULL DROP TABLE dbo.MissedTripDetectorPromotions;
IF OBJECT_ID('dbo.MissedTripReviewHistory','U') IS NOT NULL DROP TABLE dbo.MissedTripReviewHistory;
IF OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
IF OBJECT_ID('dbo.GtfsScheduledTrips','U') IS NOT NULL DROP TABLE dbo.GtfsScheduledTrips;
IF OBJECT_ID('dbo.RouteClassification','U') IS NOT NULL DROP TABLE dbo.RouteClassification;
IF OBJECT_ID('dbo.OtpReasonCodes','U') IS NOT NULL DROP TABLE dbo.OtpReasonCodes;
IF OBJECT_ID('dbo.ComplianceOccurrences','U') IS NOT NULL DROP TABLE dbo.ComplianceOccurrences;
`;

const BEFORE = `
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, route_id NVARCHAR(50) NOT NULL,
  scheduled_departure_at DATETIME2 NOT NULL, grace_deadline_at DATETIME2 NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT 'escalated', detected_late_arrival_at DATETIME2 NULL, suggested_alert_id UNIQUEIDENTIFIER NULL,
  first_seen_watching_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), last_checked_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  validation_status NVARCHAR(20) NOT NULL DEFAULT 'unreviewed', validated_by NVARCHAR(200) NULL, validated_at DATETIME2 NULL,
  notes NVARCHAR(1000) NULL, detection_type NVARCHAR(30) NULL, reason_code NVARCHAR(30) NULL,
  detector_version NVARCHAR(30) NULL, data_quality_status NVARCHAR(30) NOT NULL DEFAULT 'legacy_unverified',
  source_system NVARCHAR(20) NOT NULL DEFAULT 'gtfs', source_record_id NVARCHAR(100) NULL, evidence_json NVARCHAR(MAX) NULL,
  undecided_reason NVARCHAR(60) NULL,
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date),
  CONSTRAINT CK_MonitoredMissedTrips_Status CHECK (status IN ('watching', 'escalated', 'resolved')),
  CONSTRAINT CK_MonitoredMissedTrips_ValidationStatus CHECK (validation_status IN ('unreviewed', 'confirmed', 'false_positive'))
);
CREATE TABLE dbo.MissedTripReviewHistory (
  review_id BIGINT IDENTITY(1,1) PRIMARY KEY,
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL,
  previous_validation_status NVARCHAR(20) NOT NULL, validation_status NVARCHAR(20) NOT NULL,
  reason_code NVARCHAR(30) NOT NULL, notes NVARCHAR(1000) NULL, reviewed_by NVARCHAR(200) NOT NULL,
  reviewed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_MissedTripReviewHistory_Trip FOREIGN KEY (trip_id, service_date) REFERENCES dbo.MonitoredMissedTrips(trip_id, service_date),
  CONSTRAINT CK_MissedTripReviewHistory_PreviousStatus CHECK (previous_validation_status IN ('unreviewed', 'confirmed', 'false_positive')),
  CONSTRAINT CK_MissedTripReviewHistory_Status CHECK (validation_status IN ('confirmed', 'false_positive'))
);
CREATE TABLE dbo.GtfsScheduledTrips (
  trip_id NVARCHAR(100) NOT NULL PRIMARY KEY, route_id NVARCHAR(50) NOT NULL, service_id NVARCHAR(100) NULL,
  first_departure_seconds INT NOT NULL
);
CREATE TABLE dbo.RouteClassification (
  route_id INT NOT NULL PRIMARY KEY, route_category NVARCHAR(20) NOT NULL, route_label NVARCHAR(100) NULL
);
CREATE TABLE dbo.OtpReasonCodes (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(), code NVARCHAR(30) NOT NULL, label NVARCHAR(100) NOT NULL, applies_to NVARCHAR(20) NOT NULL
);
CREATE TABLE dbo.ComplianceOccurrences (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), source_ref NVARCHAR(300) NULL,
  review_status NVARCHAR(20) NOT NULL DEFAULT 'candidate', attribution NVARCHAR(30) NOT NULL DEFAULT 'undetermined'
);
INSERT INTO dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, validation_status, detection_type, data_quality_status, detector_version) VALUES
  ('FP', '20260915', '460', '2026-09-15T14:00:00', '2026-09-15T14:30:00', 'escalated', 'false_positive', 'silent_no_show', 'experimental', 'gtfs-silent-v3'),
  ('OK', '20260915', '460', '2026-09-15T14:00:00', '2026-09-15T14:30:00', 'escalated', 'confirmed', 'silent_no_show', 'source_verified', 'gtfs-silent-v3'),
  ('Q',  '20260915', '460', '2026-09-15T14:00:00', '2026-09-15T14:30:00', 'escalated', 'unreviewed', 'silent_no_show', 'experimental', 'gtfs-silent-v3'),
  ('L',  '20260915', '460', '2026-09-15T14:00:00', '2026-09-15T14:30:00', 'resolved', 'unreviewed', NULL, 'legacy_unverified', NULL);
INSERT INTO dbo.MissedTripReviewHistory (trip_id, service_date, previous_validation_status, validation_status, reason_code, notes, reviewed_by) VALUES
  ('FP', '20260915', 'unreviewed', 'confirmed', 'OPERATOR', NULL, 'occ@example.com'),
  ('FP', '20260915', 'confirmed', 'false_positive', 'RAN', 'AVL shows it ran', 'occ@example.com');
`;

async function applyMigration(pool: sql.ConnectionPool, file: string) {
  const text = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await pool.request().batch(DROP); } finally { await pool.close(); }
});

test("migration 125 names false_positive Timely service once, adds the window and review columns, and classifies vw_MissedTrip", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(BEFORE);
    await applyMigration(pool, "migration-125-missed-trip-review-outcomes-and-window.sql");
    await applyMigration(pool, "migration-125-missed-trip-review-outcomes-and-window.sql");

    const widths = (await pool.request().query<{ cases: number; history: number; previous: number; defaults: number }>(`
      SELECT COL_LENGTH('dbo.MonitoredMissedTrips', 'validation_status') cases,
             COL_LENGTH('dbo.MissedTripReviewHistory', 'validation_status') history,
             COL_LENGTH('dbo.MissedTripReviewHistory', 'previous_validation_status') previous,
             (SELECT COUNT(*) FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('dbo.MonitoredMissedTrips')
                AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.MonitoredMissedTrips'), 'validation_status', 'ColumnId')) defaults`)).recordset[0];
    assert.deepEqual(widths, { cases: 60, history: 60, previous: 60, defaults: 1 });

    const cases = (await pool.request().query<{ trip_id: string; validation_status: string }>(
      "SELECT trip_id, validation_status FROM dbo.MonitoredMissedTrips ORDER BY trip_id",
    )).recordset;
    assert.deepEqual(cases.map((c) => [c.trip_id, c.validation_status]), [["FP", "timely_service"], ["L", "unreviewed"], ["OK", "confirmed"], ["Q", "unreviewed"]]);

    const history = (await pool.request().query<{ previous_validation_status: string; validation_status: string; notes: string | null; review_kind: string }>(
      "SELECT previous_validation_status, validation_status, notes, review_kind FROM dbo.MissedTripReviewHistory ORDER BY review_id",
    )).recordset;
    assert.deepEqual(history.map((h) => [h.previous_validation_status, h.validation_status, h.review_kind]), [["unreviewed", "confirmed", "review"], ["confirmed", "timely_service", "review"]]);
    assert.equal(history[1].notes, "AVL shows it ran [Recorded as false_positive; migration 125 names this outcome Timely service.]");

    // The new outcomes, columns and window are accepted.
    await pool.request().query(`
      UPDATE dbo.MonitoredMissedTrips SET validation_status = 'partial_service_failure' WHERE trip_id = 'OK';
      INSERT INTO dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type, data_quality_status, detector_version, expected_window_end_at)
        VALUES ('W', '20260915', '460', '2026-09-15T14:00:00', '2026-09-15T14:30:00', 'escalated', 'silent_no_show', 'experimental', 'gtfs-silent-v4', DATEADD(DAY, 1, SYSUTCDATETIME()));
      INSERT INTO dbo.MissedTripReviewHistory (trip_id, service_date, previous_validation_status, validation_status, reason_code, reviewed_by, review_kind, review_reason)
        VALUES ('OK', '20260915', 'confirmed', 'partial_service_failure', 'PARTIAL', 'occ@example.com', 'supersede', 'Skipped its first stop');
      INSERT INTO dbo.GtfsScheduledTrips (trip_id, route_id, first_departure_seconds, last_arrival_seconds) VALUES ('T', '460', 25200, 28800);
    `);

    const view = (await pool.request().query(`
      SELECT v.TripId, v.IsConfirmed, v.Lifecycle, v.EvidenceFinding, v.ReviewOutcome, v.Detector, v.HeldReason, v.IsLegacy, v.IsHeld,
             v.InReviewQueue, v.IsConcluded, v.IsFlaggedMissed, v.CountsAsMissed, v.CountsTowardAssessment,
             m.status, m.validation_status, m.data_quality_status, m.detection_type, m.source_system, m.undecided_reason,
             m.grace_deadline_at, m.detected_late_arrival_at, m.detector_version, m.expected_window_end_at
      FROM dbo.vw_MissedTrip v JOIN dbo.MonitoredMissedTrips m ON m.trip_id = v.TripId AND m.service_date = v.ServiceDateKey
      ORDER BY v.TripId`)).recordset;
    assert.equal(view.length, 5);
    for (const row of view) {
      const c = classifyMissedTripCase(row, []);
      assert.deepEqual(
        [row.Lifecycle, row.EvidenceFinding, row.ReviewOutcome ?? null, row.Detector, row.HeldReason ?? null, row.IsLegacy, row.IsHeld,
          row.InReviewQueue, row.IsConcluded, row.IsFlaggedMissed, row.CountsAsMissed, row.CountsTowardAssessment, row.IsConfirmed],
        [c.lifecycle, c.evidence_finding, c.review_outcome, c.detector, c.held_reason, c.legacy, c.held,
          c.in_queue, c.concluded, c.flagged_missed, c.counts_as_missed, c.counts_toward_assessment, c.review_outcome === "confirmed_missed_trip"],
        row.TripId,
      );
    }
    assert.deepEqual(view.map((r) => [r.TripId, r.Lifecycle]), [["FP", "reviewed"], ["L", "legacy"], ["OK", "reviewed"], ["Q", "ready_for_review"], ["W", "awaiting_evidence"]]);

    // A confirmed missed trip on 20260915 from the silent no-show detector: the
    // only kind of case promotion can change. ('OK' was superseded above.)
    await pool.request().query(`
      INSERT INTO dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, validation_status, detection_type, data_quality_status, detector_version)
        VALUES ('P', '20260915', '460', '2026-09-15T14:00:00', '2026-09-15T14:30:00', 'escalated', 'confirmed', 'silent_no_show', 'source_verified', 'gtfs-silent-v3')`);

    // Migration 134: the promotion history, and the same view reading it.
    await applyMigration(pool, "migration-134-missed-trip-detector-promotion.sql");
    await applyMigration(pool, "migration-134-missed-trip-detector-promotion.sql");

    const countsToward = async () => (await pool.request().query<{ TripId: string; CountsTowardAssessment: boolean }>(
      "SELECT TripId, CountsTowardAssessment FROM dbo.vw_MissedTrip ORDER BY TripId")).recordset
      .filter((r) => r.CountsTowardAssessment).map((r) => r.TripId);

    // An empty history says what the setting said: nothing is promoted.
    assert.deepEqual(await countsToward(), []);

    // A promotion from the following month does not reach a case on 20260915.
    const promote = async (on: string, promoted = true) => {
      await pool.request().input("e", sql.Char(8), on).input("p", sql.Bit, promoted ? 1 : 0).query(
        `INSERT INTO dbo.MissedTripDetectorPromotions (detector, effective_service_date, promoted, reason, decided_by)
         VALUES (N'gtfs_silent_no_show', @e, @p, N'contract test', N'test@example.com')`);
    };
    await promote("20261001");
    assert.deepEqual(await countsToward(), []);
    await promote("20260901");
    assert.deepEqual(await countsToward(), ["P"]);
    // Demoted from the day before: the case stops counting.
    await promote("20260914", false);
    assert.deepEqual(await countsToward(), []);

    // And the app says the same thing about the same rows.
    const promotions = (await pool.request().query<DetectorPromotionEntry>(
      `SELECT detector, effective_service_date, promoted, reason, measured_precision, sample_size, decided_by, decided_at
       FROM dbo.MissedTripDetectorPromotions`)).recordset;
    const windows = promotionWindows(promotions.map((h) => ({ ...h, promoted: h.promoted === true })));
    const promotedRows = (await pool.request().query<{ TripId: string; ServiceDateKey: string; CountsTowardAssessment: boolean;
      status: string; validation_status: string; data_quality_status: string; detection_type: string | null; source_system: string | null;
      undecided_reason: string | null; grace_deadline_at: Date; detected_late_arrival_at: Date | null; detector_version: string | null;
      expected_window_end_at: Date | null }>(`
      SELECT v.TripId, v.ServiceDateKey, v.CountsTowardAssessment, m.status, m.validation_status, m.data_quality_status,
             m.detection_type, m.source_system, m.undecided_reason, m.grace_deadline_at, m.detected_late_arrival_at,
             m.detector_version, m.expected_window_end_at
      FROM dbo.vw_MissedTrip v JOIN dbo.MonitoredMissedTrips m ON m.trip_id = v.TripId AND m.service_date = v.ServiceDateKey`)).recordset;
    for (const row of promotedRows) {
      assert.equal(row.CountsTowardAssessment,
        classifyMissedTripCase({ ...row, service_date: row.ServiceDateKey }, windows).counts_toward_assessment, row.TripId);
    }
  } finally {
    await pool.close();
  }
});
