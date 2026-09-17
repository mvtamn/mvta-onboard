import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyMissedTripCase, missedTripCaseSql, promotedDetectors, WINDOWED_DETECTOR_VERSION, type ClassifiableCase } from "./classify";

const DEADLINE = new Date("2026-09-17T14:30:00Z");

function row(overrides: Partial<ClassifiableCase> = {}): ClassifiableCase {
  return {
    status: "escalated", validation_status: "unreviewed", data_quality_status: "experimental",
    detection_type: "silent_no_show", source_system: "gtfs", undecided_reason: null,
    grace_deadline_at: DEADLINE, detected_late_arrival_at: null, detector_version: "gtfs-silent-v3", expected_window_end_at: null, ...overrides,
  };
}

const none = new Set<never>();

test("lifecycle and the queue follow one rule", () => {
  const rows: [Partial<ClassifiableCase>, string, boolean][] = [
    [{}, "ready_for_review", true],
    [{ status: "watching", undecided_reason: "awaiting_confirmation" }, "awaiting_evidence", false],
    [{ status: "watching", data_quality_status: "unknown_data_gap", undecided_reason: "static_schedule_stale" }, "awaiting_evidence", false],
    [{ status: "watching" }, "open", false],
    [{ status: "resolved" }, "closed_by_evidence", false],
    [{ validation_status: "confirmed", data_quality_status: "source_verified" }, "reviewed", false],
    [{ data_quality_status: "legacy_unverified" }, "legacy", false],
    [{ data_quality_status: "legacy_unverified", validation_status: "confirmed" }, "legacy", false],
  ];
  for (const [overrides, lifecycle, inQueue] of rows) {
    const c = classifyMissedTripCase(row(overrides), none);
    assert.equal(c.lifecycle, lifecycle, JSON.stringify(overrides));
    assert.equal(c.in_queue, inQueue, JSON.stringify(overrides));
  }
});

test("the Dispatch Log's missed flag excludes held, data-gap, closed, legacy and Timely-service cases", () => {
  assert.equal(classifyMissedTripCase(row(), none).flagged_missed, true);
  assert.equal(classifyMissedTripCase(row({ validation_status: "confirmed" }), none).flagged_missed, true);
  for (const overrides of [
    { status: "watching", undecided_reason: "awaiting_confirmation" },
    { data_quality_status: "unknown_data_gap", status: "watching", undecided_reason: "x" },
    { status: "resolved" },
    { data_quality_status: "legacy_unverified" },
    { validation_status: "false_positive" },
  ]) {
    assert.equal(classifyMissedTripCase(row(overrides), none).flagged_missed, false, JSON.stringify(overrides));
  }
});

test("only a Confirmed missed trip from a promoted detector counts toward assessment", () => {
  const confirmed = row({ validation_status: "confirmed", data_quality_status: "source_verified" });
  assert.equal(classifyMissedTripCase(confirmed, none).counts_as_missed, true);
  assert.equal(classifyMissedTripCase(confirmed, none).counts_toward_assessment, false);
  assert.equal(classifyMissedTripCase(confirmed, promotedDetectors("gtfs_silent_no_show")).counts_toward_assessment, true);
  assert.equal(classifyMissedTripCase({ ...confirmed, source_system: "spare", detection_type: "spare_late_start" }, promotedDetectors("gtfs_silent_no_show")).counts_toward_assessment, false);
  assert.equal(classifyMissedTripCase({ ...confirmed, data_quality_status: "legacy_unverified" }, promotedDetectors("gtfs_silent_no_show")).counts_toward_assessment, false);
});

test("findings name what the evidence shows", () => {
  const rows: [Partial<ClassifiableCase>, string][] = [
    [{}, "suspected_no_show"],
    [{ detected_late_arrival_at: new Date("2026-09-17T14:45:00Z") }, "late_trip_start"],
    [{ status: "resolved", detected_late_arrival_at: new Date("2026-09-17T14:20:00Z") }, "timely_service"],
    [{ detection_type: "explicit_cancellation", data_quality_status: "source_verified" }, "advance_cancellation"],
    [{ data_quality_status: "unknown_data_gap", status: "watching", undecided_reason: "x" }, "indeterminate"],
    [{ source_system: "spare", detection_type: "spare_late_arrival" }, "on_demand_service_failure"],
  ];
  for (const [overrides, finding] of rows) assert.equal(classifyMissedTripCase(row(overrides), none).evidence_finding, finding);
});

test("promotion names are checked before they reach SQL", () => {
  assert.deepEqual([...promotedDetectors(" spare, gtfs_cancellation ,nope,'; DROP")], ["spare", "gtfs_cancellation"]);
  assert.match(missedTripCaseSql("m", "mtc", promotedDetectors("spare")), /IN \(N'spare'\)/);
  assert.match(missedTripCaseSql("m", "mtc", new Set()), /1 = 0/);
  assert.throws(() => missedTripCaseSql("m; DROP"), TypeError);
});

test("a v4 silent no-show waits in Awaiting evidence until its operating window has ended", () => {
  const now = new Date("2026-09-17T18:00:00Z");
  const windowed = row({ detector_version: WINDOWED_DETECTOR_VERSION });
  const cases: [Partial<ClassifiableCase>, string, string | null][] = [
    [{ expected_window_end_at: new Date("2026-09-17T19:00:00Z") }, "awaiting_evidence", "awaiting_operating_window"],
    [{ expected_window_end_at: null }, "awaiting_evidence", "awaiting_operating_window"],
    [{ expected_window_end_at: new Date("2026-09-17T17:00:00Z") }, "ready_for_review", null],
  ];
  for (const [overrides, lifecycle, reason] of cases) {
    const c = classifyMissedTripCase({ ...windowed, ...overrides }, none, now);
    assert.deepEqual([c.lifecycle, c.held_reason, c.flagged_missed], [lifecycle, reason, lifecycle === "ready_for_review"]);
  }
  // Earlier detector versions, cancellations and Spare cases have no window to wait for.
  assert.equal(classifyMissedTripCase(row({ detector_version: "gtfs-silent-v3" }), none, now).lifecycle, "ready_for_review");
  assert.equal(classifyMissedTripCase({ ...windowed, detection_type: "explicit_cancellation" }, none, now).lifecycle, "ready_for_review");
});

test("the four review outcomes, with false_positive read as Timely service", () => {
  const outcomes: [string, string, boolean][] = [
    ["confirmed", "confirmed_missed_trip", true],
    ["timely_service", "timely_service", false],
    ["false_positive", "timely_service", false],
    ["partial_service_failure", "partial_service_failure", false],
    ["indeterminate", "indeterminate", false],
  ];
  for (const [stored, outcome, missed] of outcomes) {
    const c = classifyMissedTripCase(row({ validation_status: stored }), none);
    assert.deepEqual([c.review_outcome, c.counts_as_missed, c.lifecycle], [outcome, missed, "reviewed"]);
  }
});

test("migration 125's vw_MissedTrip classifies with missedTripCaseSql verbatim", () => {
  const squash = (text: string) => text.replace(/\s+/g, " ").trim();
  const migration = readFileSync(join(process.cwd(), "sql", "migration-125-missed-trip-review-outcomes-and-window.sql"), "utf8");
  assert.ok(squash(migration).includes(squash(missedTripCaseSql("m", "mtc", new Set()))),
    "regenerate the CROSS APPLY in migration 125 from missedTripCaseSql(\"m\", \"mtc\", new Set())");
});
