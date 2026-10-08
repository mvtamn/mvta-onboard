import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "../../db";
import { linkFor, outstandingAvailLinks, recordAvailLinks, resolveAvailLink, type AvailEvidenceLink } from "./availLinks";
import type { AvailMatch, AvailMissedTripRow, MatchableCase } from "./avail";

// The reviewer's half of Avail reconciliation against SQL Server: a probable
// link is kept so it can be answered, a run that stops reporting a record marks
// the link instead of forgetting it, and confirming one is what makes the
// record corroborate the case.
//
// See subscriberResend.db.contract.test.ts on why the contract job runs one
// file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.AvailEvidenceLinks','U') IS NOT NULL DROP TABLE dbo.AvailEvidenceLinks;
IF OBJECT_ID('dbo.AvailMissedTripsRouteStopDay','U') IS NOT NULL DROP TABLE dbo.AvailMissedTripsRouteStopDay;
IF OBJECT_ID('dbo.MissedTripReviewHistory','U') IS NOT NULL DROP TABLE dbo.MissedTripReviewHistory;
IF OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
IF OBJECT_ID('dbo.GtfsTripDirections','U') IS NOT NULL DROP TABLE dbo.GtfsTripDirections;
IF OBJECT_ID('dbo.SpareMissedTripEvaluations','U') IS NOT NULL DROP TABLE dbo.SpareMissedTripEvaluations;
`;

const CREATE = `
CREATE TABLE dbo.GtfsTripDirections (
  trip_id NVARCHAR(100) NOT NULL PRIMARY KEY, direction_label NVARCHAR(10) NULL
);
CREATE TABLE dbo.SpareMissedTripEvaluations (
  request_id NVARCHAR(100) NOT NULL PRIMARY KEY,
  condition_late_start BIT NULL, condition_superseded BIT NULL, condition_late_arrival BIT NULL,
  start_delay_seconds INT NULL, arrival_delay_seconds INT NULL
);
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, route_id NVARCHAR(50) NOT NULL,
  scheduled_departure_at DATETIME2 NOT NULL, grace_deadline_at DATETIME2 NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT 'escalated', detected_late_arrival_at DATETIME2 NULL,
  suggested_alert_id UNIQUEIDENTIFIER NULL,
  first_seen_watching_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), last_checked_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  validation_status NVARCHAR(30) NOT NULL DEFAULT 'unreviewed', validated_by NVARCHAR(200) NULL, validated_at DATETIME2 NULL,
  notes NVARCHAR(1000) NULL, detection_type NVARCHAR(30) NULL, reason_code NVARCHAR(30) NULL,
  detector_version NVARCHAR(30) NULL, data_quality_status NVARCHAR(30) NOT NULL DEFAULT 'legacy_unverified',
  source_system NVARCHAR(20) NOT NULL DEFAULT 'gtfs', source_record_id NVARCHAR(100) NULL, evidence_json NVARCHAR(MAX) NULL,
  undecided_reason NVARCHAR(60) NULL, expected_window_end_at DATETIME2 NULL,
  evidence_conflict_at DATETIME2 NULL, evidence_conflict_reason NVARCHAR(300) NULL,
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date),
  CONSTRAINT CK_MonitoredMissedTrips_Status CHECK (status IN ('watching', 'escalated', 'resolved')),
  CONSTRAINT CK_MonitoredMissedTrips_ValidationStatus CHECK (validation_status IN ('unreviewed', 'confirmed', 'timely_service', 'partial_service_failure', 'indeterminate', 'false_positive')),
  CONSTRAINT CK_MonitoredMissedTrips_DataQuality CHECK (data_quality_status IN ('legacy_unverified', 'source_verified', 'experimental', 'unknown_data_gap')),
  CONSTRAINT CK_MonitoredMissedTrips_SourceSystem CHECK (source_system IN ('gtfs', 'spare')),
  CONSTRAINT CK_MonitoredMissedTrips_DetectionType CHECK (detection_type IS NULL OR detection_type IN
    ('explicit_cancellation', 'silent_no_show', 'spare_late_start', 'spare_superseded', 'spare_late_arrival', 'spare_multiple'))
);
CREATE TABLE dbo.MissedTripReviewHistory (
  review_id BIGINT IDENTITY(1,1) PRIMARY KEY,
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL,
  previous_validation_status NVARCHAR(30) NOT NULL, validation_status NVARCHAR(30) NOT NULL,
  reason_code NVARCHAR(30) NOT NULL, notes NVARCHAR(1000) NULL, reviewed_by NVARCHAR(200) NOT NULL,
  reviewed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  review_kind NVARCHAR(20) NULL, review_reason NVARCHAR(1000) NULL,
  CONSTRAINT FK_MissedTripReviewHistory_Trip FOREIGN KEY (trip_id, service_date) REFERENCES dbo.MonitoredMissedTrips(trip_id, service_date),
  CONSTRAINT CK_MissedTripReviewHistory_Status CHECK (validation_status IN ('confirmed', 'timely_service', 'partial_service_failure', 'indeterminate', 'false_positive'))
);
CREATE TABLE dbo.AvailMissedTripsRouteStopDay (
  id BIGINT IDENTITY(1,1) PRIMARY KEY, service_month CHAR(6) NOT NULL, calendar_date CHAR(8) NOT NULL,
  route_id INT NOT NULL, departure_stop_name NVARCHAR(200) NULL, arrival_stop_name NVARCHAR(200) NULL,
  departure_missed BIT NOT NULL DEFAULT 0, arrival_missed BIT NOT NULL DEFAULT 0,
  entire_trip_missed BIT NOT NULL DEFAULT 0, departure_trip_start_time DATETIME2 NULL
);
`;

const DAY = "20260917";
const START = new Date("2026-09-17T14:00:00Z");
const MIGRATION = "migration-136-avail-evidence-links.sql";
const LOOKBACK = 3650; // every seeded day is inside the sweep

async function applyMigration(pool: sql.ConnectionPool) {
  const text = readFileSync(join(process.cwd(), "sql", MIGRATION), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((part) => part.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

const row = (overrides: Partial<AvailMissedTripRow> = {}): AvailMissedTripRow => ({
  calendar_date: DAY, route_id: 460, departure_stop_name: "Burnsville Station",
  arrival_stop_name: "Mall of America", departure_missed: false, arrival_missed: false,
  entire_trip_missed: true, departure_trip_start_time: START, ...overrides,
});

const caseA: MatchableCase = { trip_id: "A1", service_date: DAY, route_id: "460", scheduled_departure_at: START };
const probable = (overrides: Partial<AvailMissedTripRow> = {}): AvailEvidenceLink =>
  linkFor(row(overrides), { confidence: "probable", matched: null, candidates: 2 } satisfies AvailMatch);
const exact = (overrides: Partial<AvailMissedTripRow> = {}): AvailEvidenceLink =>
  linkFor(row(overrides), { confidence: "exact", matched: caseA, candidates: 1 } satisfies AvailMatch);

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await pool.request().batch(DROP); } finally { await pool.close(); }
});

const stored = async (pool: sql.ConnectionPool) => (await pool.request().query<{
  id: number; route_id: number; match_confidence: string; resolution: string | null;
  trip_id: string | null; retracted_at: Date | null; resolved_by: string | null;
}>(`SELECT id, route_id, match_confidence, resolution, trip_id, retracted_at, resolved_by
    FROM dbo.AvailEvidenceLinks ORDER BY route_id`)).recordset;

test("Avail evidence links against SQL Server", {
  skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set",
}, async (t) => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(CREATE);
    await applyMigration(pool);
    await applyMigration(pool); // re-runnable

    await pool.request().query(`
      INSERT dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, data_quality_status, source_system)
        VALUES ('A1', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'experimental', 'gtfs'),
               ('B1', '${DAY}', '770', '2026-09-17T16:00:00', '2026-09-17T16:30:00', 'escalated', 'experimental', 'gtfs')`);

    await t.test("a probable link is kept, so there is something to confirm", async () => {
      const report = await recordAvailLinks(pool, [probable(), exact({ route_id: 999 })], LOOKBACK, new Date("2026-09-18T03:00:00Z"));
      assert.equal(report.written, 2);
      assert.equal(report.retracted, 0);
      assert.deepEqual((await stored(pool)).map((l) => [l.route_id, l.match_confidence]), [[460, "probable"], [999, "exact"]]);
    });

    await t.test("a second run over a rebuilt feed updates rather than duplicates", async () => {
      await recordAvailLinks(pool, [probable(), exact({ route_id: 999 })], LOOKBACK, new Date("2026-09-19T03:00:00Z"));
      assert.equal((await stored(pool)).length, 2);
    });

    await t.test("only a probable link waits on a reviewer", async () => {
      const exactLink = (await stored(pool)).find((l) => l.route_id === 999)!;
      const refused = await resolveAvailLink(pool, { id: exactLink.id, decision: "rejected", actor: "ops@example.com" });
      assert.equal(refused.ok, false);
      assert.equal(refused.ok === false && refused.refusal, "not_probable");
    });

    await t.test("confirming has to name a case the record could be about", async () => {
      const link = (await stored(pool)).find((l) => l.route_id === 460)!;
      const noCase = await resolveAvailLink(pool, { id: link.id, decision: "confirmed", actor: "ops@example.com" });
      assert.equal(noCase.ok === false && noCase.refusal, "case_required");
      // B1 is a real case, but on another route: it cannot be what this record describes.
      const wrongCase = await resolveAvailLink(pool, {
        id: link.id, decision: "confirmed", tripId: "B1", serviceDate: DAY, actor: "ops@example.com",
      });
      assert.equal(wrongCase.ok === false && wrongCase.refusal, "case_not_a_candidate");
    });

    await t.test("confirming names the case and corroborates it", async () => {
      const link = (await stored(pool)).find((l) => l.route_id === 460)!;
      const outcome = await resolveAvailLink(pool, {
        id: link.id, decision: "confirmed", tripId: "A1", serviceDate: DAY,
        note: "Only the 14:00 run was cancelled", actor: "ops@example.com",
      });
      assert.equal(outcome.ok, true);
      const after = (await stored(pool)).find((l) => l.route_id === 460)!;
      assert.equal(after.resolution, "confirmed");
      assert.equal(after.trip_id, "A1");
      assert.equal(after.resolved_by, "ops@example.com");
      const evidence = (await pool.request().query<{ evidence_json: string | null }>(
        "SELECT evidence_json FROM dbo.MonitoredMissedTrips WHERE trip_id = 'A1'")).recordset[0];
      assert.match(evidence.evidence_json ?? "", /avail/i, "the case now carries the Avail evidence");

      // And it is answered, so it leaves the reviewer's list.
      assert.equal((await outstandingAvailLinks(pool)).some((l) => l.route_id === 460 && l.retracted_at === null), false);
    });

    await t.test("an answer survives a run that finds the same thing again", async () => {
      await recordAvailLinks(pool, [probable(), exact({ route_id: 999 })], LOOKBACK, new Date("2026-09-20T03:00:00Z"));
      assert.equal((await stored(pool)).find((l) => l.route_id === 460)?.resolution, "confirmed");
    });

    await t.test("an answer does not survive the record being placed somewhere else", async () => {
      const moved = linkFor(row(), { confidence: "exact", matched: caseA, candidates: 1 } satisfies AvailMatch);
      await recordAvailLinks(pool, [moved, exact({ route_id: 999 })], LOOKBACK, new Date("2026-09-21T03:00:00Z"));
      const after = (await stored(pool)).find((l) => l.route_id === 460)!;
      assert.equal(after.resolution, null, "the confidence changed, so it is not the link they answered");
      assert.equal(after.match_confidence, "exact");
    });

    await t.test("a record the feed stops reporting is marked, not forgotten", async () => {
      const report = await recordAvailLinks(pool, [exact({ route_id: 999 })], LOOKBACK, new Date("2026-09-22T03:00:00Z"));
      assert.equal(report.retracted, 1);
      const gone = (await stored(pool)).find((l) => l.route_id === 460)!;
      assert.ok(gone.retracted_at, "the withdrawal is recorded");
      assert.ok((await outstandingAvailLinks(pool)).some((l) => l.route_id === 460 && l.retracted_at !== null),
        "a case that lost its corroboration is brought to a reviewer");

      // Avail reporting it again clears the mark.
      await recordAvailLinks(pool, [exact(), exact({ route_id: 999 })], LOOKBACK, new Date("2026-09-23T03:00:00Z"));
      assert.equal((await stored(pool)).find((l) => l.route_id === 460)?.retracted_at, null);
      assert.equal((await stored(pool)).length, 2, "no duplicate was created");
    });
  } finally {
    await pool.close();
  }
});
