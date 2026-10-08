import assert from "node:assert/strict";
import test from "node:test";
import { AWAITING_CONFIRMATION } from "../missedTripConfidence";
import { decideReview, decideRun, type CaseState, type RunDecision } from "./decide";
import type { CaseAct, RunFact, RunObservation } from "./types";

// The case rules as tables. missedTripCase.db.contract.test.ts proves the same
// behaviour through observeMissedTrips against SQL Server.

const NOW = new Date("2026-09-17T15:00:00Z");
const SCHEDULED = new Date("2026-09-17T14:00:00Z");
const DEADLINE = new Date("2026-09-17T14:30:00Z");

function gtfs(fact: RunFact, runId = "T1"): RunObservation {
  return { run: { source: "gtfs", runId, serviceDate: "20260917", routeId: "460", scheduledStartAt: SCHEDULED, deadlineAt: DEADLINE }, detectorVersion: "gtfs-silent-v3", fact };
}

function spare(fact: RunFact): RunObservation {
  return { run: { source: "spare", runId: "R1", serviceDate: "20260917", routeId: "Connect", scheduledStartAt: SCHEDULED, deadlineAt: DEADLINE }, detectorVersion: "spare-missed-v2", fact };
}

function stored(overrides: Partial<CaseState> = {}): CaseState {
  return {
    trip_id: "T1", service_date: "20260917", route_id: "460", scheduled_departure_at: SCHEDULED, grace_deadline_at: DEADLINE,
    status: "escalated", validation_status: "unreviewed", data_quality_status: "experimental", detection_type: "silent_no_show",
    detector_version: "gtfs-silent-v3", source_system: "gtfs", source_record_id: null, undecided_reason: null,
    detected_late_arrival_at: null, first_seen_watching_at: new Date("2026-09-17T14:40:00Z"), evidence_json: null, expected_window_end_at: null, evidence_conflict_at: null, evidence_conflict_reason: null,
    ...overrides,
  };
}

function statusAfter(decision: RunDecision | null, before: CaseState | null): string | null {
  if (!decision) return before?.status ?? null;
  return decision.kind === "insert" ? decision.row.status : decision.set.status ?? before?.status ?? null;
}

test("facts about a run with no case open one only when they can", () => {
  const rows: [RunObservation, string | null, string | null][] = [
    [gtfs({ kind: "cancellation" }), "escalated", "explicit_cancellation"],
    [gtfs({ kind: "no_start_by_deadline" }), "watching", "silent_no_show"],
    [gtfs({ kind: "undecidable", reason: "static_schedule_stale" }), "watching", "silent_no_show"],
    [spare({ kind: "service_failure", detectionType: "spare_late_arrival", arrivedAt: null }), "escalated", "spare_late_arrival"],
    [gtfs({ kind: "trip_start", at: NOW }), null, null],
    [spare({ kind: "no_failure" }), null, null],
    [spare({ kind: "evaluation_gap", reason: "missing_slots" }), null, null],
  ];
  for (const [observation, status, type] of rows) {
    const decision = decideRun(null, [observation], NOW);
    assert.equal(decision?.kind === "insert" ? decision.row.status : null, status, observation.fact.kind);
    assert.equal(decision?.kind === "insert" ? decision.row.detection_type : null, type, observation.fact.kind);
  }
  const held = decideRun(null, [gtfs({ kind: "no_start_by_deadline" })], NOW);
  assert.ok(held?.kind === "insert" && held.row.undecided_reason === AWAITING_CONFIRMATION && held.outcome === "held");
  const spareCase = decideRun(null, [spare({ kind: "service_failure", detectionType: "spare_multiple", arrivedAt: null })], NOW);
  assert.ok(spareCase?.kind === "insert" && spareCase.row.trip_id === "spare:R1" && spareCase.row.source_record_id === "R1");
});

test("a held no-show is confirmed only by a later pass that still finds no start", () => {
  const justHeld = stored({ status: "watching", undecided_reason: AWAITING_CONFIRMATION, first_seen_watching_at: new Date(NOW.getTime() - 60_000) });
  assert.equal(decideRun(justHeld, [gtfs({ kind: "no_start_by_deadline" })], NOW), null);
  const heldLong = { ...justHeld, first_seen_watching_at: new Date(NOW.getTime() - 300_000) };
  const confirmed = decideRun(heldLong, [gtfs({ kind: "no_start_by_deadline" })], NOW);
  assert.ok(confirmed?.kind === "update" && confirmed.set.status === "escalated" && confirmed.set.undecided_reason === null && confirmed.outcome === "confirmed");
  // A pass that could not decide does not confirm it.
  assert.equal(decideRun(heldLong, [gtfs({ kind: "undecidable", reason: "vehicle_position_feed_not_current" })], NOW), null);
  // An undecidable case is not upgraded by later coverage; only evidence decides it.
  const gap = stored({ status: "watching", data_quality_status: "unknown_data_gap", undecided_reason: "static_schedule_stale", first_seen_watching_at: new Date(NOW.getTime() - 900_000) });
  assert.equal(decideRun(gap, [gtfs({ kind: "no_start_by_deadline" })], NOW), null);
});

test("trip start evidence closes or decides a case, whatever order the facts arrive in", () => {
  const heldLong = stored({ status: "watching", undecided_reason: AWAITING_CONFIRMATION, first_seen_watching_at: new Date(NOW.getTime() - 300_000) });
  const timely = gtfs({ kind: "trip_start", at: new Date("2026-09-17T14:20:00Z") });
  for (const facts of [[gtfs({ kind: "no_start_by_deadline" }), timely], [timely, gtfs({ kind: "no_start_by_deadline" })]]) {
    const decision = decideRun(heldLong, facts, NOW);
    assert.ok(decision?.kind === "update" && decision.set.status === "resolved" && decision.outcome === "closed_by_evidence");
  }
  const late = gtfs({ kind: "trip_start", at: new Date("2026-09-17T14:45:00Z") });
  const gap = stored({ status: "watching", data_quality_status: "unknown_data_gap", undecided_reason: "static_schedule_stale" });
  const decided = decideRun(gap, [late], NOW);
  assert.ok(decided?.kind === "update" && decided.set.status === "escalated" && decided.set.data_quality_status === "experimental" && decided.set.undecided_reason === null);
  // Timely-service closure applies to cancellations too.
  const cancelled = stored({ detection_type: "explicit_cancellation", data_quality_status: "source_verified" });
  assert.equal(statusAfter(decideRun(cancelled, [timely], NOW), cancelled), "resolved");
});

test("closed, reviewed and legacy cases are never reopened or rewritten", () => {
  const reviewed = stored({ validation_status: "confirmed", data_quality_status: "source_verified" });
  const onlyEvidence = decideRun(reviewed, [gtfs({ kind: "trip_start", at: new Date("2026-09-17T14:20:00Z") })], NOW);
  assert.ok(onlyEvidence?.kind === "update" && onlyEvidence.set.status === undefined && onlyEvidence.set.detected_late_arrival_at !== undefined);
  assert.equal(onlyEvidence.outcome, "evidence_recorded");

  const closedSpare = stored({ trip_id: "spare:R1", source_system: "spare", source_record_id: "R1", detection_type: "spare_late_arrival", data_quality_status: "source_verified", status: "resolved" });
  const again = decideRun(closedSpare, [spare({ kind: "service_failure", detectionType: "spare_late_arrival", arrivedAt: null })], NOW);
  assert.equal(statusAfter(again, closedSpare), "resolved");

  const legacy = stored({ data_quality_status: "legacy_unverified", status: "escalated" });
  assert.equal(decideRun(legacy, [gtfs({ kind: "trip_start", at: new Date("2026-09-17T14:20:00Z") })], NOW), null);
});

test("Spare evaluations close, hold and release a case without reopening it", () => {
  const open = stored({ trip_id: "spare:R1", source_system: "spare", source_record_id: "R1", detection_type: "spare_late_start", data_quality_status: "source_verified" });
  assert.equal(statusAfter(decideRun(open, [spare({ kind: "no_failure" })], NOW), open), "resolved");
  const heldDecision = decideRun(open, [spare({ kind: "evaluation_gap", reason: "missing_slots" })], NOW);
  assert.ok(heldDecision?.kind === "update" && heldDecision.set.status === "watching" && heldDecision.set.undecided_reason === "missing_slots");
  const held = { ...open, status: "watching" as const, undecided_reason: "missing_slots" };
  const released = decideRun(held, [spare({ kind: "service_failure", detectionType: "spare_late_start", arrivedAt: null })], NOW);
  assert.ok(released?.kind === "update" && released.set.status === "escalated" && released.set.undecided_reason === null);
  // GTFS facts do not touch a Spare case, nor Spare facts a GTFS case.
  assert.equal(decideRun(open, [gtfs({ kind: "trip_start", at: NOW }, "spare:R1")], NOW), null);
  assert.equal(decideRun(stored(), [spare({ kind: "no_failure" })], NOW), null);
});

test("a repeated observation with nothing new changes nothing", () => {
  const confirmed = stored();
  assert.equal(decideRun(confirmed, [gtfs({ kind: "no_start_by_deadline" }), gtfs({ kind: "cancellation" })], NOW), null);
});

test("a silent no-show opens with its operating window; other cases have none", () => {
  const windowEnd = new Date("2026-09-17T16:10:00Z");
  const observation = gtfs({ kind: "no_start_by_deadline" });
  const opened = decideRun(null, [{ ...observation, run: { ...observation.run, operatingWindowEndAt: windowEnd } }], NOW);
  assert.ok(opened?.kind === "insert" && opened.row.expected_window_end_at?.getTime() === windowEnd.getTime());
  const cancelled = decideRun(null, [gtfs({ kind: "cancellation" })], NOW);
  assert.ok(cancelled?.kind === "insert" && cancelled.row.expected_window_end_at === null);
});

test("review acts by case state", () => {
  const review = (act: string, extra: Partial<CaseAct> = {}): CaseAct =>
    ({ act, outcome: "timely_service", reasonCode: "RAN", notes: null, attribution: "undetermined", reason: "Radio log shows it ran", ...extra }) as CaseAct;
  const unreviewed = stored();
  const reviewed = stored({ validation_status: "confirmed", data_quality_status: "source_verified" });
  const legacy = stored({ data_quality_status: "legacy_unverified" });
  const refusal = (state: CaseState, act: CaseAct) => {
    const d = decideReview(state, act, NOW);
    return "refusal" in d ? d.refusal.code : null;
  };
  assert.equal(refusal(unreviewed, review("record_review")), null);
  assert.equal(refusal(reviewed, review("record_review")), "already_reviewed");
  assert.equal(refusal(reviewed, review("supersede_review")), null);
  assert.equal(refusal(unreviewed, review("supersede_review")), "not_reviewed");
  assert.equal(refusal(reviewed, review("supersede_review", { reason: "  " })), "reason_required");
  assert.equal(refusal(legacy, review("record_review")), "legacy_record");
  assert.equal(refusal(legacy, review("rereview_legacy")), null);
  assert.equal(refusal(unreviewed, review("rereview_legacy")), "not_legacy");

  const rereviewed = decideReview(legacy, review("rereview_legacy"), NOW);
  assert.ok("review" in rereviewed);
  assert.deepEqual([rereviewed.review.data_quality_status, rereviewed.review.review_kind], ["source_verified", "legacy_rereview"]);

  // Confirming waits for evidence; other outcomes do not.
  const held = stored({ status: "watching", undecided_reason: AWAITING_CONFIRMATION });
  assert.equal(refusal(held, review("record_review", { outcome: "confirmed" })), "awaiting_evidence");
  assert.equal(refusal(held, review("record_review", { outcome: "indeterminate" })), null);
  const windowOpen = stored({ detector_version: "gtfs-silent-v4", expected_window_end_at: new Date(NOW.getTime() + 3_600_000) });
  assert.equal(refusal(windowOpen, review("record_review", { outcome: "confirmed" })), "awaiting_evidence");
  const windowClosed = { ...windowOpen, expected_window_end_at: new Date(NOW.getTime() - 60_000) };
  assert.equal(refusal(windowClosed, review("record_review", { outcome: "confirmed" })), null);
});

// ADR-0035: Avail corroborates, contradicts and enriches. It never opens a
// case, never reopens one, never closes one, and never rewrites a review - so
// the only state it can change is the Evidence conflict.
function avail(fact: RunFact, runId = "T1"): RunObservation {
  return {
    run: { source: "avail", runId, serviceDate: "20260917", routeId: "460", scheduledStartAt: SCHEDULED, deadlineAt: SCHEDULED },
    detectorVersion: "avail-retrospective-v1",
    fact,
    evidence: { source: "avail", entireTripMissed: true },
  };
}

function setOf(decision: RunDecision | null): Partial<CaseState> {
  return decision?.kind === "update" ? decision.set : {};
}

test("Avail never opens a case", () => {
  assert.equal(decideRun(null, [avail({ kind: "retrospective_missed" })], NOW), null);
  assert.equal(decideRun(null, [avail({ kind: "retrospective_partial", missedDeparture: true, missedArrival: false })], NOW), null);
});

test("Avail agreeing with an open case records evidence and changes nothing else", () => {
  const decision = decideRun(stored(), [avail({ kind: "retrospective_missed" })], NOW);
  const set = setOf(decision);
  assert.equal(set.status, undefined, "the case is not escalated by a vendor report");
  assert.equal(set.evidence_conflict_at, undefined);
  assert.match(String(set.evidence_json), /"avail"/);
});

test("Avail agreeing with a confirmed review is not a conflict", () => {
  const decision = decideRun(
    stored({ validation_status: "confirmed" }),
    [avail({ kind: "retrospective_missed" })],
    NOW,
  );
  assert.equal(setOf(decision).evidence_conflict_at, undefined);
});

test("Avail contradicting a case closed as Timely service is an Evidence conflict", () => {
  // Closed by evidence: resolved and never reviewed.
  const decision = decideRun(
    stored({ status: "resolved" }),
    [avail({ kind: "retrospective_missed" })],
    NOW,
  );
  const set = setOf(decision);
  assert.deepEqual(set.evidence_conflict_at, NOW);
  assert.match(String(set.evidence_conflict_reason), /Avail reports this run as missed/);
  assert.equal(set.status, undefined, "the case is not reopened");
  assert.equal(set.validation_status, undefined, "no review is rewritten");
});

test("Avail contradicting a human Timely service review is an Evidence conflict too", () => {
  for (const reviewed of ["timely_service", "false_positive"]) {
    const decision = decideRun(stored({ validation_status: reviewed }), [avail({ kind: "retrospective_missed" })], NOW);
    assert.deepEqual(setOf(decision).evidence_conflict_at, NOW, `validation_status=${reviewed}`);
  }
});

test("Avail reporting a partial failure on a confirmed missed trip is a conflict", () => {
  // The case says it never ran; Avail says it ran and missed a stop.
  const decision = decideRun(
    stored({ validation_status: "confirmed" }),
    [avail({ kind: "retrospective_partial", missedDeparture: true, missedArrival: false })],
    NOW,
  );
  assert.deepEqual(setOf(decision).evidence_conflict_at, NOW);
  assert.match(String(setOf(decision).evidence_conflict_reason), /operated with a missed stop/);
});

test("a conflict is recorded once and keeps its first timestamp", () => {
  const later = new Date(NOW.getTime() + 86_400_000);
  const decision = decideRun(
    stored({ status: "resolved", evidence_conflict_at: NOW, evidence_conflict_reason: "already noted" }),
    [avail({ kind: "retrospective_missed" })],
    later,
  );
  assert.equal(setOf(decision).evidence_conflict_at, undefined, "the existing conflict stands");
  assert.equal(setOf(decision).evidence_conflict_reason, undefined);
});

test("Avail evidence sits beside what the live sources recorded, not on top of it", () => {
  const decision = decideRun(
    stored({ evidence_json: JSON.stringify({ source: "spare", requestId: "R1" }) }),
    [avail({ kind: "retrospective_missed" })],
    NOW,
  );
  const merged = JSON.parse(String(setOf(decision).evidence_json));
  assert.equal(merged.requestId, "R1", "the earlier source's evidence survives");
  assert.equal(merged.avail.entireTripMissed, true);
});

test("a Legacy missed-trip record is not touched by Avail either", () => {
  assert.equal(
    decideRun(stored({ data_quality_status: "legacy_unverified" }), [avail({ kind: "retrospective_missed" })], NOW),
    null,
  );
});
