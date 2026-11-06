import assert from "node:assert/strict";
import test, { after } from "node:test";
import { parseConnectionString, sql } from "../db";
import { actOnMissedTripCase } from "./index";
import { readMissedTripCases } from "./reads";
import { REVIEW_EVIDENCE_KEY, type ReviewEvidenceSnapshot } from "./reviewEvidence";
import { writeDecision } from "./store";

// The evidence kept at review, against a real SQL Server. reviewEvidence.test.ts
// covers the JSON; this covers what only the database can show:
//
//   A review writes what the reviewer saw - the Dispatch Log, vehicle, block,
//   origin stop and OTP Daily readings - into evidence_json, keyed to its
//   MissedTripReviewHistory row, in the review's own transaction.
//
//   Once the source rows are gone (the Dispatch Log pruned, OTP Daily purged
//   after 90 days), the reviewed case still lists with that evidence.
//
//   A second review adds its own snapshot and keeps the first.
//
//   A failed read is recorded as failed, and the review still lands.
//
//   A background pass decided before the review cannot write over the
//   snapshot.
//
// Tables are built by hand to the columns the code uses, as in
// missedTripCase.db.contract.test.ts and caseEvidence.db.contract.test.ts. See
// subscriberResend.db.contract.test.ts on why the contract job runs one file
// at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.MissedTripDetectorPromotions','U') IS NOT NULL DROP TABLE dbo.MissedTripDetectorPromotions;
IF OBJECT_ID('dbo.MissedTripReviewHistory','U') IS NOT NULL DROP TABLE dbo.MissedTripReviewHistory;
IF OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
IF OBJECT_ID('dbo.GtfsTripDirections','U') IS NOT NULL DROP TABLE dbo.GtfsTripDirections;
IF OBJECT_ID('dbo.SpareMissedTripEvaluations','U') IS NOT NULL DROP TABLE dbo.SpareMissedTripEvaluations;
IF OBJECT_ID('dbo.TripStartLog','U') IS NOT NULL DROP TABLE dbo.TripStartLog;
IF OBJECT_ID('dbo.GtfsTripOperationalEvidence','U') IS NOT NULL DROP TABLE dbo.GtfsTripOperationalEvidence;
IF OBJECT_ID('dbo.OtpDailyRouteStopHour','U') IS NOT NULL DROP TABLE dbo.OtpDailyRouteStopHour;
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
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date)
);
CREATE TABLE dbo.MissedTripReviewHistory (
  review_id BIGINT IDENTITY(1,1) PRIMARY KEY,
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL,
  previous_validation_status NVARCHAR(30) NOT NULL, validation_status NVARCHAR(30) NOT NULL,
  reason_code NVARCHAR(30) NOT NULL, notes NVARCHAR(1000) NULL, reviewed_by NVARCHAR(200) NOT NULL,
  reviewed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  review_kind NVARCHAR(20) NULL, review_reason NVARCHAR(1000) NULL,
  CONSTRAINT FK_MissedTripReviewHistory_Trip FOREIGN KEY (trip_id, service_date) REFERENCES dbo.MonitoredMissedTrips(trip_id, service_date)
);
CREATE TABLE dbo.MissedTripDetectorPromotions (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  detector NVARCHAR(40) NOT NULL, effective_service_date CHAR(8) NOT NULL, promoted BIT NOT NULL,
  reason NVARCHAR(1000) NOT NULL, measured_precision DECIMAL(5,4) NULL, sample_size INT NULL,
  decided_by NVARCHAR(200) NOT NULL, decided_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.TripStartLog (
  service_date CHAR(8) NOT NULL, trip_id NVARCHAR(100) NOT NULL, route_id NVARCHAR(50) NULL, block_id NVARCHAR(100) NULL,
  origin_stop_id NVARCHAR(100) NULL, origin_stop_name NVARCHAR(200) NULL,
  scheduled_start_at DATETIME2 NOT NULL, actual_start_at DATETIME2 NULL, actual_start_source NVARCHAR(20) NULL,
  predicted_start_at DATETIME2 NULL, actuals_updated_at DATETIME2 NULL,
  CONSTRAINT PK_TripStartLog PRIMARY KEY (service_date, trip_id)
);
CREATE TABLE dbo.GtfsTripOperationalEvidence (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, vehicle_id NVARCHAR(100) NULL,
  first_vehicle_position_at DATETIME2 NULL, first_underway_at DATETIME2 NULL,
  CONSTRAINT PK_GtfsTripOperationalEvidence PRIMARY KEY (trip_id, service_date)
);
CREATE TABLE dbo.OtpDailyRouteStopHour (
  calendar_date CHAR(8) NOT NULL, hour_of_day TINYINT NOT NULL, route_id INT NOT NULL, stop_id INT NOT NULL,
  missed INT NULL, actual_departures INT NULL, total INT NULL
);
`;

const DAY = "20261016";
// 15:20Z on 16 Oct is 10:20 CDT: OTP Daily's hour 10 on the 16th.
const SCHEDULED = new Date("2026-10-16T15:20:00Z");
const DEADLINE = new Date("2026-10-16T15:50:00Z");
// The Dispatch Log's departure: 4 minutes late, apart from the schedule and
// the last prediction, so it reads as departed.
const LEFT = new Date("2026-10-16T15:24:00Z");
const reviewer = { kind: "person" as const, name: "occ@example.com" };
const fields = { reasonCode: "OPERATOR", notes: null, attribution: "undetermined" as const };

// A decided silent no-show from the shadow-detection v4 detector, its
// operating window over, so it can be confirmed.
async function seedCase(pool: sql.ConnectionPool, trip: string): Promise<void> {
  await pool.request()
    .input("trip", sql.NVarChar(100), trip).input("day", sql.NVarChar(20), DAY)
    .input("scheduled", sql.DateTime2, SCHEDULED).input("deadline", sql.DateTime2, DEADLINE).input("left", sql.DateTime2, LEFT)
    .query(`
      INSERT dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status,
        detection_type, data_quality_status, source_system, detector_version, expected_window_end_at, evidence_json)
      VALUES (@trip, @day, N'475', @scheduled, @deadline, N'escalated', N'silent_no_show', N'experimental', N'gtfs', N'gtfs-silent-v4',
        DATEADD(HOUR, 1, @deadline), N'{"avail_otp_origin":{"departures":2}}');
      INSERT dbo.TripStartLog (service_date, trip_id, route_id, block_id, origin_stop_id, origin_stop_name, scheduled_start_at,
        actual_start_at, actual_start_source, predicted_start_at, actuals_updated_at)
      VALUES (@day, @trip, N'475', N'515-v64', N'51990', N'Apple Valley Transit Station', @scheduled,
        @left, N'trip_update', DATEADD(MINUTE, -1, @left), DATEADD(MINUTE, 1, @left));
      INSERT dbo.GtfsTripOperationalEvidence (trip_id, service_date, vehicle_id, first_vehicle_position_at, first_underway_at)
      VALUES (@trip, @day, N'4265', DATEADD(MINUTE, -10, @scheduled), NULL);`);
}

async function stored(pool: sql.ConnectionPool, trip: string): Promise<{ json: Record<string, unknown>; raw: string }> {
  const raw = (await pool.request().input("trip", sql.NVarChar(100), trip)
    .query<{ evidence_json: string }>("SELECT evidence_json FROM dbo.MonitoredMissedTrips WHERE trip_id = @trip")).recordset[0].evidence_json;
  return { json: JSON.parse(raw) as Record<string, unknown>, raw };
}

async function reviewIds(pool: sql.ConnectionPool, trip: string): Promise<number[]> {
  return (await pool.request().input("trip", sql.NVarChar(100), trip)
    .query<{ review_id: string | number }>("SELECT review_id FROM dbo.MissedTripReviewHistory WHERE trip_id = @trip ORDER BY review_id"))
    .recordset.map((r) => Number(r.review_id));
}

const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await pool.request().batch(DROP); } finally { await pool.close(); }
});

test("Evidence kept at review, against SQL Server", skip, async (t) => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(CREATE);
    await pool.request().query(`INSERT dbo.OtpDailyRouteStopHour VALUES ('20261016', 10, 475, 51990, 0, 2, 2)`);

    await t.test("a review keeps the readings the reviewer saw, keyed to its history row", async () => {
      await seedCase(pool, "KEEP");
      const acted = await actOnMissedTripCase(pool, { tripId: "KEEP", serviceDate: DAY }, { act: "record_review", outcome: "confirmed", ...fields }, reviewer);
      assert.ok(acted.ok);

      const { json } = await stored(pool, "KEEP");
      // Evidence other sources kept is left as it was.
      assert.deepEqual(json.avail_otp_origin, { departures: 2 });
      const snapshots = json[REVIEW_EVIDENCE_KEY] as ReviewEvidenceSnapshot[];
      assert.equal(snapshots.length, 1);
      const [snapshot] = snapshots;
      assert.deepEqual(await reviewIds(pool, "KEEP"), [snapshot.review_id]);
      assert.equal(snapshot.reviewed_by, reviewer.name);
      assert.equal(snapshot.outcome, "confirmed");
      assert.equal(snapshot.read_failed, null);
      assert.equal(snapshot.evidence?.departure.reading, "departed");
      assert.equal(snapshot.evidence?.started_at, LEFT.toISOString());
      assert.equal(snapshot.evidence?.started_late_minutes, 4);
      assert.equal(snapshot.evidence?.vehicle.vehicle_id, "4265");
      assert.deepEqual(snapshot.evidence?.block, { block_id: "515", trips: 1, trips_reported: 1 });
      assert.equal(snapshot.evidence?.origin_stop?.stop_id, "51990");
      assert.equal(snapshot.evidence?.origin_stop?.name, "Apple Valley Transit Station");
      assert.deepEqual(snapshot.evidence?.avail_otp, { hour: 10, trips_starting: 1, departed: 2, missed: 0, all_left: true });
    });

    await t.test("once its sources are purged, the reviewed case still shows what was decided on", async () => {
      await seedCase(pool, "OPEN");
      await pool.request().batch(`
        DELETE dbo.TripStartLog WHERE trip_id = N'KEEP';
        DELETE dbo.GtfsTripOperationalEvidence WHERE trip_id = N'KEEP';
        DELETE dbo.OtpDailyRouteStopHour;`);
      const read = await readMissedTripCases(pool, { view: "all", limit: 50, offset: 0 });
      assert.ok(read.ready);
      assert.equal(read.evidenceError, undefined);
      const kept = read.cases.find((c) => c.trip_id === "KEEP");
      assert.equal(kept?.gtfs_evidence?.departure.reading, "departed");
      assert.equal(kept?.gtfs_evidence?.vehicle.vehicle_id, "4265");
      assert.deepEqual(kept?.gtfs_evidence?.avail_otp, { hour: 10, trips_starting: 1, departed: 2, missed: 0, all_left: true });
      assert.equal(kept?.review_evidence?.reviewed_by, reviewer.name);
      assert.equal(kept?.review_evidence?.read_failed, null);
      // An unreviewed case is still read live, and has no review evidence.
      const open = read.cases.find((c) => c.trip_id === "OPEN");
      assert.equal(open?.review_evidence, null);
      assert.equal(open?.gtfs_evidence?.avail_otp, null, "OTP Daily was purged, and the live read says so");
      assert.equal(open?.gtfs_evidence?.vehicle.vehicle_id, "4265");
    });

    await t.test("a superseding review adds its own snapshot and keeps the first", async () => {
      const acted = await actOnMissedTripCase(pool, { tripId: "KEEP", serviceDate: DAY },
        { act: "supersede_review", outcome: "timely_service", reason: "The Dispatch Log shows it left on time", ...fields }, reviewer);
      assert.ok(acted.ok);
      const snapshots = (await stored(pool, "KEEP")).json[REVIEW_EVIDENCE_KEY] as ReviewEvidenceSnapshot[];
      assert.deepEqual(snapshots.map((s) => s.review_id), await reviewIds(pool, "KEEP"));
      assert.deepEqual(snapshots.map((s) => s.outcome), ["confirmed", "timely_service"]);
      assert.equal(snapshots[0].evidence?.vehicle.vehicle_id, "4265", "the first review's evidence is untouched");
      // The second review read after the purge: the Dispatch Log no longer
      // has the trip, and that is what this reviewer saw.
      assert.equal(snapshots[1].evidence?.departure.reading, "not_recorded");
    });

    await t.test("a failed read is recorded as failed, and the review still lands", async () => {
      await seedCase(pool, "BLIND");
      await pool.request().batch("DROP TABLE dbo.GtfsTripOperationalEvidence;");
      const acted = await actOnMissedTripCase(pool, { tripId: "BLIND", serviceDate: DAY }, { act: "record_review", outcome: "indeterminate", ...fields }, reviewer);
      assert.ok(acted.ok);
      const [snapshot] = (await stored(pool, "BLIND")).json[REVIEW_EVIDENCE_KEY] as ReviewEvidenceSnapshot[];
      assert.equal(snapshot.evidence, null);
      assert.match(snapshot.read_failed ?? "", /not there to read/);
      const read = await readMissedTripCases(pool, { view: "all", limit: 50, offset: 0 });
      assert.ok(read.ready);
      const blind = read.cases.find((c) => c.trip_id === "BLIND");
      assert.match(blind?.review_evidence?.read_failed ?? "", /not there to read/);
      await pool.request().batch(`CREATE TABLE dbo.GtfsTripOperationalEvidence (
        trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, vehicle_id NVARCHAR(100) NULL,
        first_vehicle_position_at DATETIME2 NULL, first_underway_at DATETIME2 NULL);`);
    });

    await t.test("a pass decided before the review cannot write over its snapshot", async () => {
      await seedCase(pool, "RACE");
      const before = (await stored(pool, "RACE")).raw;
      // Reviewed with the same outcome a supersede could leave: only the
      // evidence differs from what the pass read.
      assert.ok((await actOnMissedTripCase(pool, { tripId: "RACE", serviceDate: DAY }, { act: "record_review", outcome: "confirmed", ...fields }, reviewer)).ok);
      assert.ok((await actOnMissedTripCase(pool, { tripId: "RACE", serviceDate: DAY },
        { act: "supersede_review", outcome: "confirmed", reason: "Rechecked", ...fields }, reviewer)).ok);
      const stale = await writeDecision(pool, {
        kind: "update",
        key: { trip_id: "RACE", service_date: DAY },
        expect: { status: "escalated", validation_status: "confirmed", evidence_json: before },
        set: { evidence_json: JSON.stringify({ avail: { stale: true } }) },
        outcome: "evidence_recorded",
      });
      assert.equal(stale, false);
      assert.equal(((await stored(pool, "RACE")).json[REVIEW_EVIDENCE_KEY] as unknown[]).length, 2);
      // The same write made from what is stored now goes through.
      const current = (await stored(pool, "RACE")).raw;
      assert.equal(await writeDecision(pool, {
        kind: "update",
        key: { trip_id: "RACE", service_date: DAY },
        expect: { status: "escalated", validation_status: "confirmed", evidence_json: current },
        set: { evidence_json: current },
        outcome: "evidence_recorded",
      }), true);
    });
  } finally {
    await pool.close();
  }
});
