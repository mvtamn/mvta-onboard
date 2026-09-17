import assert from "node:assert/strict";
import test, { after } from "node:test";
import { parseConnectionString, sql } from "../db";
import { AWAITING_CONFIRMATION } from "../missedTripConfidence";
import { actOnMissedTripCase, classifyMissedTripCase, missedTripCaseSql, observeMissedTrips, type RunFact, type RunObservation } from "./index";
import { decideRun } from "./decide";
import { loadCases, writeDecision } from "./store";

// The Missed-trip case module against a real SQL Server. decide.test.ts and
// classify.test.ts cover the rules; this file covers what only the database can
// show:
//
//   observeMissedTrips writes what the rules decide - including across passes,
//   which is where the Spare reopen and second-poll confirmation live.
//
//   A background write never overwrites a review that landed after the pass
//   read the case.
//
//   missedTripCaseSql and classifyMissedTripCase agree on every row. Every reader
//   (queue, totals, monthly summary, Dispatch Log, compliance candidates) uses
//   the SQL; the review endpoint uses the TypeScript.
//
// The table is built by hand to the shape migrations 011, 023, 026, 029, 087,
// 121 and 124 leave it in (migration124.db.contract.test.ts applies 124 itself) (as migration106.db.contract.test.ts does), without the
// SuggestedAlerts foreign key. See subscriberResend.db.contract.test.ts on why
// the contract job runs one file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.MissedTripReviewHistory','U') IS NOT NULL DROP TABLE dbo.MissedTripReviewHistory;
IF OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
`;

const CREATE = `
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, route_id NVARCHAR(50) NOT NULL,
  scheduled_departure_at DATETIME2 NOT NULL, grace_deadline_at DATETIME2 NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT 'escalated', detected_late_arrival_at DATETIME2 NULL,
  suggested_alert_id UNIQUEIDENTIFIER NULL,
  first_seen_watching_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), last_checked_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  validation_status NVARCHAR(20) NOT NULL DEFAULT 'unreviewed', validated_by NVARCHAR(200) NULL, validated_at DATETIME2 NULL,
  notes NVARCHAR(1000) NULL, detection_type NVARCHAR(30) NULL, reason_code NVARCHAR(30) NULL,
  detector_version NVARCHAR(30) NULL, data_quality_status NVARCHAR(30) NOT NULL DEFAULT 'legacy_unverified',
  source_system NVARCHAR(20) NOT NULL DEFAULT 'gtfs', source_record_id NVARCHAR(100) NULL, evidence_json NVARCHAR(MAX) NULL,
  undecided_reason NVARCHAR(60) NULL, expected_window_end_at DATETIME2 NULL,
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
  previous_validation_status NVARCHAR(20) NOT NULL, validation_status NVARCHAR(20) NOT NULL,
  reason_code NVARCHAR(30) NOT NULL, notes NVARCHAR(1000) NULL, reviewed_by NVARCHAR(200) NOT NULL,
  reviewed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  review_kind NVARCHAR(20) NULL, review_reason NVARCHAR(1000) NULL,
  CONSTRAINT FK_MissedTripReviewHistory_Trip FOREIGN KEY (trip_id, service_date) REFERENCES dbo.MonitoredMissedTrips(trip_id, service_date),
  CONSTRAINT CK_MissedTripReviewHistory_Status CHECK (validation_status IN ('confirmed', 'timely_service', 'partial_service_failure', 'indeterminate', 'false_positive'))
);
`;

const DAY = "20260917";
const SCHEDULED = new Date("2026-09-17T14:00:00Z");
const DEADLINE = new Date("2026-09-17T14:30:00Z");
const T0 = new Date("2026-09-17T14:35:00Z");
const minutesAfter = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000);

function gtfs(runId: string, fact: RunFact): RunObservation {
  return { run: { source: "gtfs", runId, serviceDate: DAY, routeId: "460", scheduledStartAt: SCHEDULED, deadlineAt: DEADLINE }, detectorVersion: "gtfs-silent-v3", fact };
}

function spare(runId: string, fact: RunFact): RunObservation {
  return { run: { source: "spare", runId, serviceDate: DAY, routeId: "Connect", scheduledStartAt: SCHEDULED, deadlineAt: DEADLINE }, detectorVersion: "spare-missed-v2", fact };
}

interface CaseRow { status: string; validation_status: string; data_quality_status: string; undecided_reason: string | null; detection_type: string | null; detected_late_arrival_at: Date | null }

async function read(pool: sql.ConnectionPool, tripId: string): Promise<CaseRow | undefined> {
  return (await pool.request().input("t", sql.NVarChar(100), tripId).query<CaseRow>(
    "SELECT status, validation_status, data_quality_status, undecided_reason, detection_type, detected_late_arrival_at FROM dbo.MonitoredMissedTrips WHERE trip_id = @t AND service_date = '20260917'",
  )).recordset[0];
}

const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };
const reviewer = { kind: "person" as const, name: "occ@example.com" };

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await pool.request().batch(DROP); } finally { await pool.close(); }
});

test("Missed-trip cases against SQL Server", skip, async (t) => {
  delete process.env.MISSED_TRIP_PROMOTED_DETECTORS;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(CREATE);

    await t.test("a no-show is held, then confirmed by a later pass that still finds no start", async () => {
      const first = await observeMissedTrips(pool, [gtfs("NS1", { kind: "no_start_by_deadline" })], T0);
      assert.equal(first.held, 1);
      assert.deepEqual([(await read(pool, "NS1"))?.status, (await read(pool, "NS1"))?.undecided_reason], ["watching", AWAITING_CONFIRMATION]);
      // first_seen_watching_at is the database's clock; confirm relative to it.
      const seen = (await pool.request().query<{ at: Date }>("SELECT first_seen_watching_at at FROM dbo.MonitoredMissedTrips WHERE trip_id = 'NS1'")).recordset[0].at;
      assert.equal((await observeMissedTrips(pool, [gtfs("NS1", { kind: "no_start_by_deadline" })], minutesAfter(seen, 1))).confirmed, 0);
      assert.equal((await observeMissedTrips(pool, [gtfs("NS1", { kind: "no_start_by_deadline" })], minutesAfter(seen, 5))).confirmed, 1);
      assert.deepEqual([(await read(pool, "NS1"))?.status, (await read(pool, "NS1"))?.undecided_reason], ["escalated", null]);
    });

    await t.test("timely start evidence closes an unreviewed case, cancellations included, and never a reviewed one", async () => {
      await observeMissedTrips(pool, [gtfs("C1", { kind: "cancellation" }), gtfs("R1", { kind: "cancellation" })], T0);
      await actOnMissedTripCase(pool, { tripId: "R1", serviceDate: DAY }, { act: "record_review", outcome: "confirmed", reasonCode: "OPERATOR", notes: null, attribution: "undetermined" }, reviewer);
      const timely = { kind: "trip_start" as const, at: minutesAfter(SCHEDULED, 10) };
      const report = await observeMissedTrips(pool, [gtfs("C1", timely), gtfs("R1", timely), gtfs("NOCASE", timely)], T0);
      assert.equal(report.closedByEvidence, 1);
      assert.equal(report.created, 0);
      assert.equal((await read(pool, "C1"))?.status, "resolved");
      const reviewed = await read(pool, "R1");
      assert.deepEqual([reviewed?.status, reviewed?.validation_status], ["escalated", "confirmed"]);
      assert.ok(reviewed?.detected_late_arrival_at instanceof Date);
      assert.equal(await read(pool, "NOCASE"), undefined);
    });

    await t.test("a Spare case closed by a later evaluation is not reopened by the next one", async () => {
      const failure = { kind: "service_failure" as const, detectionType: "spare_late_arrival" as const, arrivedAt: null };
      await observeMissedTrips(pool, [spare("SP1", failure)], T0);
      assert.equal((await read(pool, "spare:SP1"))?.status, "escalated");
      await observeMissedTrips(pool, [spare("SP1", { kind: "no_failure" })], T0);
      assert.equal((await read(pool, "spare:SP1"))?.status, "resolved");
      await observeMissedTrips(pool, [spare("SP1", failure)], T0);
      assert.equal((await read(pool, "spare:SP1"))?.status, "resolved");

      await observeMissedTrips(pool, [spare("SP2", failure)], T0);
      await observeMissedTrips(pool, [spare("SP2", { kind: "evaluation_gap", reason: "missing_slots" })], T0);
      assert.deepEqual([(await read(pool, "spare:SP2"))?.status, (await read(pool, "spare:SP2"))?.undecided_reason], ["watching", "missing_slots"]);
      await observeMissedTrips(pool, [spare("SP2", failure)], T0);
      assert.deepEqual([(await read(pool, "spare:SP2"))?.status, (await read(pool, "spare:SP2"))?.undecided_reason], ["escalated", null]);
      // A gap for a request nobody flagged opens nothing.
      assert.equal((await observeMissedTrips(pool, [spare("SP3", { kind: "evaluation_gap", reason: "missing_slots" })], T0)).held, 0);
      assert.equal(await read(pool, "spare:SP3"), undefined);
    });

    await t.test("a pass never overwrites a review that landed after it read the case", async () => {
      await observeMissedTrips(pool, [gtfs("RACE", { kind: "cancellation" })], T0);
      const observations = [gtfs("RACE", { kind: "trip_start", at: minutesAfter(SCHEDULED, 5) })];
      const snapshot = (await loadCases(pool, [{ tripId: "RACE", serviceDate: DAY }])).get(`RACE|${DAY}`)!;
      const decision = decideRun(snapshot, observations, T0)!;
      await actOnMissedTripCase(pool, { tripId: "RACE", serviceDate: DAY }, { act: "record_review", outcome: "confirmed", reasonCode: "OPERATOR", notes: null, attribution: "undetermined" }, reviewer);
      assert.equal(await writeDecision(pool, decision), false);
      assert.deepEqual([(await read(pool, "RACE"))?.status, (await read(pool, "RACE"))?.validation_status], ["escalated", "confirmed"]);
    });

    await t.test("legacy records are left alone by observations", async () => {
      await pool.request().query(`INSERT INTO dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type, data_quality_status)
        VALUES ('LEG', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'silent_no_show', 'legacy_unverified')`);
      await observeMissedTrips(pool, [gtfs("LEG", { kind: "trip_start", at: minutesAfter(SCHEDULED, 5) })], T0);
      assert.equal((await read(pool, "LEG"))?.status, "escalated");
    });

    await t.test("a review records its history, and a shadow detector's confirmation stays out of assessment", async () => {
      await observeMissedTrips(pool, [gtfs("REV", { kind: "cancellation" })], T0);
      const outcome = await actOnMissedTripCase(pool, { tripId: "REV", serviceDate: DAY }, { act: "record_review", outcome: "confirmed", reasonCode: "OPERATOR", notes: "Checked radio log", attribution: "contractor_error" }, reviewer);
      assert.ok(outcome.ok);
      assert.deepEqual(outcome.handOff, { linked: false, reason: "shadow_detection" });
      assert.equal(outcome.classification.lifecycle, "reviewed");
      assert.equal(outcome.classification.counts_toward_assessment, false);
      const history = (await pool.request().query<{ previous_validation_status: string; validation_status: string; reviewed_by: string }>(
        "SELECT previous_validation_status, validation_status, reviewed_by FROM dbo.MissedTripReviewHistory WHERE trip_id = 'REV'",
      )).recordset;
      assert.deepEqual(history, [{ previous_validation_status: "unreviewed", validation_status: "confirmed", reviewed_by: reviewer.name }]);
      const missing = await actOnMissedTripCase(pool, { tripId: "NOPE", serviceDate: DAY }, { act: "record_review", outcome: "confirmed", reasonCode: "OPERATOR", notes: null, attribution: "undetermined" }, reviewer);
      assert.ok(!missing.ok && missing.refusal.code === "not_found");
    });

    await t.test("a second review supersedes with a reason, a legacy record needs a rereview, and confirming waits for evidence", async () => {
      const key = { tripId: "SUP", serviceDate: DAY };
      await observeMissedTrips(pool, [gtfs("SUP", { kind: "cancellation" })], T0);
      const fields = { reasonCode: "OPERATOR", notes: null, attribution: "undetermined" as const };
      assert.ok((await actOnMissedTripCase(pool, key, { act: "record_review", outcome: "confirmed", ...fields }, reviewer)).ok);
      const again = await actOnMissedTripCase(pool, key, { act: "record_review", outcome: "timely_service", ...fields }, reviewer);
      assert.ok(!again.ok && again.refusal.code === "already_reviewed");
      const superseded = await actOnMissedTripCase(pool, key, { act: "supersede_review", outcome: "timely_service", reason: "AVL shows it left on time", ...fields }, reviewer);
      assert.ok(superseded.ok && superseded.classification.review_outcome === "timely_service");
      const history = (await pool.request().query<{ previous_validation_status: string; validation_status: string; review_kind: string; review_reason: string | null }>(
        "SELECT previous_validation_status, validation_status, review_kind, review_reason FROM dbo.MissedTripReviewHistory WHERE trip_id = 'SUP' ORDER BY review_id",
      )).recordset;
      assert.deepEqual(history, [
        { previous_validation_status: "unreviewed", validation_status: "confirmed", review_kind: "review", review_reason: null },
        { previous_validation_status: "confirmed", validation_status: "timely_service", review_kind: "supersede", review_reason: "AVL shows it left on time" },
      ]);

      await pool.request().query(`INSERT INTO dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type, data_quality_status)
        VALUES ('LEG2', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'silent_no_show', 'legacy_unverified')`);
      const legacyKey = { tripId: "LEG2", serviceDate: DAY };
      const plain = await actOnMissedTripCase(pool, legacyKey, { act: "record_review", outcome: "indeterminate", ...fields }, reviewer);
      assert.ok(!plain.ok && plain.refusal.code === "legacy_record");
      const rereviewed = await actOnMissedTripCase(pool, legacyKey, { act: "rereview_legacy", outcome: "indeterminate", reason: "Rechecked against the radio log", ...fields }, reviewer);
      assert.ok(rereviewed.ok && rereviewed.classification.lifecycle === "reviewed" && !rereviewed.classification.legacy);

      await pool.request().query(`INSERT INTO dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type, data_quality_status, source_system, detector_version, expected_window_end_at)
        VALUES ('WAIT', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'silent_no_show', 'experimental', 'gtfs', 'gtfs-silent-v4', DATEADD(DAY, 1, SYSUTCDATETIME()))`);
      const early = await actOnMissedTripCase(pool, { tripId: "WAIT", serviceDate: DAY }, { act: "record_review", outcome: "confirmed", ...fields }, reviewer);
      assert.ok(!early.ok && early.refusal.code === "awaiting_evidence");
      assert.equal((await read(pool, "WAIT"))?.validation_status, "unreviewed");
    });

    await t.test("the SQL classification agrees with the TypeScript classification on every row", async () => {
      // One of each shape the rules distinguish, on top of what the passes above left.
      await pool.request().query(`INSERT INTO dbo.MonitoredMissedTrips
        (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, validation_status, detection_type, data_quality_status, source_system, undecided_reason, detected_late_arrival_at)
        VALUES
        ('K1', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'watching', 'unreviewed', 'silent_no_show', 'unknown_data_gap', 'gtfs', NULL, NULL),
        ('K2', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'unreviewed', 'silent_no_show', 'experimental', 'gtfs', NULL, '2026-09-17T14:50:00'),
        ('K3', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'watching', 'unreviewed', 'silent_no_show', 'experimental', 'gtfs', NULL, NULL),
        ('K4', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'resolved', 'false_positive', 'silent_no_show', 'experimental', 'gtfs', NULL, NULL),
        ('K5', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'confirmed', 'silent_no_show', 'legacy_unverified', 'gtfs', NULL, NULL),
        ('K6', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'partial_service_failure', 'silent_no_show', 'experimental', 'gtfs', NULL, NULL),
        ('K7', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'indeterminate', 'spare_late_start', 'source_verified', 'spare', NULL, NULL)`);
      // Silent no-shows that carry an operating window, far enough either side
      // of now that the database clock and this process's clock agree.
      await pool.request().query(`INSERT INTO dbo.MonitoredMissedTrips
        (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, validation_status, detection_type, data_quality_status, source_system, detector_version, expected_window_end_at)
        VALUES
        ('W1', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'unreviewed', 'silent_no_show', 'experimental', 'gtfs', 'gtfs-silent-v4', DATEADD(DAY, 1, SYSUTCDATETIME())),
        ('W2', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'unreviewed', 'silent_no_show', 'experimental', 'gtfs', 'gtfs-silent-v4', DATEADD(DAY, -1, SYSUTCDATETIME())),
        ('W3', '${DAY}', '460', '2026-09-17T14:00:00', '2026-09-17T14:30:00', 'escalated', 'unreviewed', 'silent_no_show', 'experimental', 'gtfs', 'gtfs-silent-v4', NULL)`);
      for (const promoted of ["", "gtfs_cancellation,spare"]) {
        process.env.MISSED_TRIP_PROMOTED_DETECTORS = promoted;
        const rows = (await pool.request().query(`
          SELECT m.trip_id, m.status, m.validation_status, m.data_quality_status, m.detection_type, m.source_system,
                 m.undecided_reason, m.grace_deadline_at, m.detected_late_arrival_at, m.detector_version, m.expected_window_end_at,
                 mtc.lifecycle, mtc.evidence_finding, mtc.review_outcome, mtc.detector, mtc.held_reason,
                 mtc.legacy, mtc.held, mtc.in_queue, mtc.concluded, mtc.flagged_missed, mtc.counts_as_missed, mtc.counts_toward_assessment
          FROM dbo.MonitoredMissedTrips m ${missedTripCaseSql("m")}`)).recordset;
        // NS1, C1, R1, SP1, SP2, RACE, LEG, REV and the review subtests' cases, plus K1-K7 and W1-W3.
        assert.ok(rows.length >= 18);
        assert.deepEqual(
          rows.filter((r) => /^W/.test(r.trip_id)).map((r) => [r.trip_id, r.lifecycle]).sort(),
          [["W1", "awaiting_evidence"], ["W2", "ready_for_review"], ["W3", "awaiting_evidence"]],
        );
        for (const row of rows) {
          const expected = classifyMissedTripCase(row);
          const actual = {
            lifecycle: row.lifecycle, evidence_finding: row.evidence_finding, review_outcome: row.review_outcome ?? null,
            detector: row.detector, held_reason: row.held_reason ?? null, legacy: row.legacy, held: row.held,
            in_queue: row.in_queue, concluded: row.concluded, flagged_missed: row.flagged_missed,
            counts_as_missed: row.counts_as_missed, counts_toward_assessment: row.counts_toward_assessment,
          };
          assert.deepEqual(actual, expected, `${row.trip_id} with promoted="${promoted}"`);
        }
      }
      delete process.env.MISSED_TRIP_PROMOTED_DETECTORS;
    });
  } finally {
    await pool.close();
  }
});
