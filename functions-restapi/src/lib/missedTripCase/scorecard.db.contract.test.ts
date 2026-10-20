import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "../db";
import { classifyMissedTripCase, type ClassifiableCase } from "./classify";
import { readDetectorScorecard } from "./scorecard";

// The Detector scorecard against SQL Server: its four queries run, they count
// what classify.ts says each case is, and the Avail and Dispatch Log
// comparisons count the records a promotion decision has to answer for.
//
// See subscriberResend.db.contract.test.ts on why the contract job runs one
// file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const DROP = `
IF OBJECT_ID('dbo.AvailEvidenceLinks','U') IS NOT NULL DROP TABLE dbo.AvailEvidenceLinks;
IF OBJECT_ID('dbo.AvailMissedTripsRouteStopDay','U') IS NOT NULL DROP TABLE dbo.AvailMissedTripsRouteStopDay;
IF OBJECT_ID('dbo.TripStartVerifications','U') IS NOT NULL DROP TABLE dbo.TripStartVerifications;
IF OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL DROP TABLE dbo.MonitoredMissedTrips;
`;

const CREATE = `
CREATE TABLE dbo.MonitoredMissedTrips (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL, route_id NVARCHAR(50) NOT NULL,
  scheduled_departure_at DATETIME2 NOT NULL, grace_deadline_at DATETIME2 NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT 'escalated', detected_late_arrival_at DATETIME2 NULL,
  validation_status NVARCHAR(30) NOT NULL DEFAULT 'unreviewed', validated_by NVARCHAR(200) NULL, validated_at DATETIME2 NULL,
  detection_type NVARCHAR(30) NULL, detector_version NVARCHAR(30) NULL,
  data_quality_status NVARCHAR(30) NOT NULL DEFAULT 'legacy_unverified',
  source_system NVARCHAR(20) NOT NULL DEFAULT 'gtfs', source_record_id NVARCHAR(100) NULL,
  undecided_reason NVARCHAR(60) NULL, expected_window_end_at DATETIME2 NULL,
  evidence_conflict_at DATETIME2 NULL, evidence_conflict_reason NVARCHAR(300) NULL,
  CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date)
);
CREATE TABLE dbo.AvailMissedTripsRouteStopDay (
  id BIGINT IDENTITY(1,1) PRIMARY KEY, service_month CHAR(6) NOT NULL, calendar_date CHAR(8) NOT NULL,
  route_id INT NOT NULL, departure_stop_name NVARCHAR(200) NULL, arrival_stop_name NVARCHAR(200) NULL,
  departure_missed BIT NOT NULL DEFAULT 0, arrival_missed BIT NOT NULL DEFAULT 0,
  entire_trip_missed BIT NOT NULL DEFAULT 0, departure_trip_start_time DATETIME2 NULL
);
CREATE TABLE dbo.TripStartVerifications (
  service_date CHAR(8) NOT NULL, trip_id NVARCHAR(100) NOT NULL, observation NVARCHAR(20) NOT NULL,
  verified_by NVARCHAR(200) NOT NULL, verified_initials NVARCHAR(10) NOT NULL,
  verified_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), note NVARCHAR(500) NULL,
  CONSTRAINT PK_TripStartVerifications PRIMARY KEY (service_date, trip_id)
);
`;

// Wednesday of the week of 12 October; "today" is the Tuesday after.
const DAY = "20261014";
const TODAY = "20261020";
const WEEK = { from: "20261012", to: "20261018", grouping: "week" as const };

async function applyMigration(pool: sql.ConnectionPool, name: string) {
  const text = readFileSync(join(process.cwd(), "sql", name), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((part) => part.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

// One row per situation the scorecard has to tell apart. Times are UTC; the
// deadline is 14:30 and a review two hours later took two hours.
const CASES = `
INSERT dbo.MonitoredMissedTrips (trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status,
  validation_status, validated_at, detection_type, data_quality_status, source_system, undecided_reason, evidence_conflict_at)
VALUES
  ('S1', '${DAY}', '460', '2026-10-14T14:00', '2026-10-14T14:30', 'escalated', 'confirmed', '2026-10-14T16:30', 'silent_no_show', 'source_verified', 'gtfs', NULL, NULL),
  ('S2', '${DAY}', '460', '2026-10-14T15:00', '2026-10-14T14:30', 'escalated', 'confirmed', '2026-10-14T16:30', 'silent_no_show', 'source_verified', 'gtfs', NULL, NULL),
  -- Reviewed before its deadline: counts as no time, never negative.
  ('S3', '${DAY}', '460', '2026-10-14T16:00', '2026-10-14T14:30', 'escalated', 'timely_service', '2026-10-14T13:30', 'silent_no_show', 'source_verified', 'gtfs', NULL, NULL),
  ('S4', '${DAY}', '460', '2026-10-14T17:00', '2026-10-14T14:30', 'escalated', 'indeterminate', '2026-10-14T16:30', 'silent_no_show', 'source_verified', 'gtfs', NULL, NULL),
  ('S5', '${DAY}', '460', '2026-10-14T18:00', '2026-10-14T14:30', 'escalated', 'unreviewed', NULL, 'silent_no_show', 'source_verified', 'gtfs', N'feed_gap', NULL),
  ('S6', '${DAY}', '770', '2026-10-14T14:00', '2026-10-14T14:30', 'resolved', 'unreviewed', NULL, 'silent_no_show', 'source_verified', 'gtfs', NULL, NULL),
  ('S7', '${DAY}', '460', '2026-10-14T19:00', '2026-10-14T14:30', 'escalated', 'confirmed', '2026-10-14T16:30', 'silent_no_show', 'legacy_unverified', 'gtfs', NULL, NULL),
  ('S8', '${DAY}', '460', '2026-10-14T20:00', '2026-10-14T14:30', 'escalated', 'confirmed', '2026-10-14T16:30', 'silent_no_show', 'source_verified', 'gtfs', NULL, '2026-10-15T03:00'),
  ('C1', '${DAY}', '460', '2026-10-14T21:00', '2026-10-14T14:30', 'escalated', 'unreviewed', NULL, 'explicit_cancellation', 'source_verified', 'gtfs', NULL, NULL),
  ('spare:1', '${DAY}', 'MVTA Connect', '2026-10-14T14:00', '2026-10-14T14:30', 'escalated', 'confirmed', '2026-10-14T16:30', 'spare_late_start', 'source_verified', 'spare', NULL, NULL),
  -- Outside the week: never counted.
  ('S9', '20261021', '460', '2026-10-21T14:00', '2026-10-21T14:30', 'escalated', 'timely_service', '2026-10-21T16:30', 'silent_no_show', 'source_verified', 'gtfs', NULL, NULL);
`;

const link = (route: number, start: string, entire: number, confidence: string, trip: string | null,
  extra: { resolution?: string; retracted?: boolean } = {}) =>
  `('${DAY}', ${route}, N'Burnsville Station', N'Mall of America', '${start}', ${entire ? 0 : 1}, 0, ${entire},
    N'${confidence}', 1, N'seeded', ${trip ? `N'${trip}'` : "NULL"}, ${trip ? `N'${DAY}'` : "NULL"},
    ${extra.resolution ? `N'${extra.resolution}'` : "NULL"}, ${extra.retracted ? "'2026-10-16T03:00'" : "NULL"})`;

const LINKS = `
INSERT dbo.AvailEvidenceLinks (calendar_date, route_id, departure_stop_name, arrival_stop_name, departure_trip_start_time,
  departure_missed, arrival_missed, entire_trip_missed, match_confidence, candidate_count, match_reason, trip_id, service_date,
  resolution, retracted_at)
VALUES
  ${link(460, "2026-10-14T14:00", 1, "exact", "S1")},
  ${link(770, "2026-10-14T14:00", 1, "exact", "S6")},
  ${link(999, "2026-10-14T14:00", 1, "unmatched", null)},
  ${link(460, "2026-10-14T09:00", 1, "probable", null)},
  ${link(460, "2026-10-14T10:00", 1, "probable", null, { resolution: "rejected" })},
  ${link(460, "2026-10-14T11:00", 1, "exact", "S4", { retracted: true })},
  ${link(460, "2026-10-14T15:00", 0, "exact", "S2")};
`;

const VERIFICATIONS = `
INSERT dbo.TripStartVerifications (service_date, trip_id, observation, verified_by, verified_initials)
VALUES ('${DAY}', 'S1', 'not_observed', 'ops@example.com', 'OP'),
       ('${DAY}', 'S2', 'observed_on_time', 'ops@example.com', 'OP'),
       ('${DAY}', 'X1', 'not_observed', 'ops@example.com', 'OP'),
       ('${DAY}', 'X2', 'observed_on_time', 'ops@example.com', 'OP');
`;

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await pool.request().batch(DROP); } finally { await pool.close(); }
});

test("Detector scorecard against SQL Server", {
  skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set",
}, async (t) => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(DROP);
    await pool.request().batch(CREATE);
    await pool.request().batch(CASES);

    await t.test("without the comparison tables, the case figures still answer and the comparisons are null", async () => {
      await pool.request().batch("DROP TABLE dbo.TripStartVerifications");
      const scorecard = await readDetectorScorecard(pool, WEEK, TODAY);
      assert.deepEqual(scorecard.sources, { avail: false, dispatch_log: false });
      const silent = scorecard.periods[0].detectors.find((d) => d.detector === "gtfs_silent_no_show")!;
      assert.equal(silent.cases.reviewed, 5);
      assert.equal(silent.avail, null);
      assert.equal(scorecard.periods[0].dispatcher_recall, null);
      await pool.request().batch(CREATE.slice(CREATE.indexOf("CREATE TABLE dbo.TripStartVerifications")));
    });

    await applyMigration(pool, "migration-136-avail-evidence-links.sql");
    await pool.request().batch(LINKS);
    await pool.request().batch(VERIFICATIONS);
    const scorecard = await readDetectorScorecard(pool, WEEK, TODAY);
    const [period] = scorecard.periods;
    const figures = (detector: string) => period.detectors.find((d) => d.detector === detector)!;

    await t.test("counts each case the way classify.ts classifies it", async () => {
      const rows = (await pool.request().query<ClassifiableCase>(`
        SELECT service_date, status, evidence_conflict_at, validation_status, data_quality_status, detection_type,
               source_system, undecided_reason, grace_deadline_at, detected_late_arrival_at, detector_version,
               expected_window_end_at
        FROM dbo.MonitoredMissedTrips WHERE service_date BETWEEN '${WEEK.from}' AND '${WEEK.to}'`)).recordset;
      for (const detector of ["gtfs_cancellation", "gtfs_silent_no_show", "spare"] as const) {
        const mine = rows.map((row) => classifyMissedTripCase(row)).filter((c) => c.detector === detector);
        const is = (lifecycle: string) => mine.filter((c) => c.lifecycle === lifecycle).length;
        const { open, closed_by_evidence, held, awaiting_review, reviewed, legacy } = figures(detector).cases;
        assert.deepEqual(
          { open, closed_by_evidence, held, awaiting_review, reviewed, legacy },
          {
            open: is("open"), closed_by_evidence: is("closed_by_evidence"), held: is("awaiting_evidence"),
            awaiting_review: is("ready_for_review"), reviewed: is("reviewed"), legacy: is("legacy"),
          },
          detector,
        );
      }
    });

    await t.test("precision is measured on reviewer outcomes, without legacy records or indeterminate reviews", async () => {
      const silent = figures("gtfs_silent_no_show");
      assert.deepEqual(silent.outcomes, { confirmed: 3, timely_service: 1, partial_service_failure: 0, indeterminate: 1 });
      assert.equal(silent.sample, 4);
      assert.equal(silent.precision, 0.75);
      assert.equal(silent.cases.legacy, 1);
      assert.equal(silent.cases.evidence_conflicts, 1);
      assert.deepEqual(silent.held_reasons, [{ reason: "feed_gap", count: 1 }]);
      assert.equal(silent.unknown_rate, 2 / 6);
      assert.equal(silent.review.average_hours_to_review, 1.6, "four two-hour reviews and one at its deadline");
      assert.match(silent.bar!.sentence, /75\.0% precision over 4 case\(s\) is below 95%/);
      assert.equal(figures("spare").precision, 1);
      assert.match(figures("gtfs_cancellation").bar!.sentence, /1 case\(s\) still waiting/);
    });

    await t.test("Avail corroborates a flagged case, and a retracted record says nothing", async () => {
      assert.deepEqual(figures("gtfs_silent_no_show").avail, { corroborated: 1, partial: 1, confirmed_without_avail: 2 });
      assert.equal(figures("spare").avail, null);
    });

    await t.test("Avail's whole-trip misses no flagged case accounts for are what recall is measured on", async () => {
      assert.deepEqual(period.avail_recall, {
        whole_misses: 5, caught: 1, linked_not_flagged: 1, awaiting_reviewer: 1, unmatched: 2,
        recall: 0.25, unmatched_rate: 0.4,
      });
    });

    await t.test("the Dispatch Log agrees, disagrees, and finds a trip nobody flagged", async () => {
      assert.deepEqual(figures("gtfs_silent_no_show").dispatcher,
        { not_observed: 1, observed_on_time: 1, observed_left_late: 0, agreement: 0.5 });
      assert.deepEqual(period.dispatcher_recall, { verifications: 4, not_observed: 2, caught: 1, missed: 1, recall: 0.5 });
    });
  } finally {
    await pool.close();
  }
});
