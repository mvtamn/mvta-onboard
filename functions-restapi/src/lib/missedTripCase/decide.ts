// The Missed-trip case decision: given what is stored for one run (or nothing)
// and everything the sources observed about it in one pass, the row to insert
// or the change to make. Pure; store.ts loads the snapshots and writes the
// result. This is the module's internal seam.
//
// The same guards hold for every source:
//   - an undecidable observation holds a case; it never closes one;
//   - a case Closed by evidence or Reviewed is never reopened - later
//     observations are recorded as evidence only;
//   - Timely-service closure never touches a reviewed case;
//   - a Legacy missed-trip record is not changed by observations at all.
//
// Observations may arrive in any order and grouping. They are applied in the
// order the decision needs: facts that can create a case, then evidence, then
// the second-poll confirmation - so a trip that turned out to have run is
// closed before confirmation could promote it.
import { AWAITING_CONFIRMATION, NO_SHOW_CONFIRMATION_SECONDS } from "../missedTripConfidence";
import type { RunObservation } from "./types";

export type CaseStatus = "watching" | "escalated" | "resolved";

// The columns the decision reads and writes.
export interface CaseState {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_departure_at: Date;
  grace_deadline_at: Date;
  status: CaseStatus;
  validation_status: string;
  data_quality_status: string;
  detection_type: string | null;
  detector_version: string | null;
  source_system: string;
  source_record_id: string | null;
  undecided_reason: string | null;
  detected_late_arrival_at: Date | null;
  first_seen_watching_at: Date;
  evidence_json: string | null;
}

export type DecisionOutcome = "created" | "held" | "confirmed" | "closed_by_evidence" | "evidence_recorded";

export type RunDecision =
  | { kind: "insert"; row: CaseState; outcome: "created" | "held" }
  | {
      kind: "update";
      key: { trip_id: string; service_date: string };
      // The status and review the write expects to find; a row changed since
      // it was read is left for the next run.
      expect: { status: CaseStatus; validation_status: string };
      set: Partial<CaseState>;
      outcome: Exclude<DecisionOutcome, "created">;
    };

const UNDECIDED_REASON_MAX = 60;

export function caseTripId(source: RunObservation["run"]["source"], runId: string): string {
  return source === "spare" ? `spare:${runId}` : runId;
}

function clipReason(reason: string): string {
  return reason.slice(0, UNDECIDED_REASON_MAX);
}

function evidenceJson(evidence: unknown): string | null {
  return evidence === undefined ? null : JSON.stringify(evidence);
}

function isHeld(state: CaseState): boolean {
  return state.undecided_reason !== null || state.data_quality_status === "unknown_data_gap";
}

// The first observation that can open a case, by precedence: an explicit
// signal before an inference, a decided inference before an undecided one.
const CREATES = ["cancellation", "service_failure", "no_start_by_deadline", "undecidable"] as const;

function created(observations: RunObservation[], now: Date): CaseState | null {
  for (const kind of CREATES) {
    const observation = observations.find((o) => o.fact.kind === kind);
    if (!observation) continue;
    const { run, fact } = observation;
    const base = {
      trip_id: caseTripId(run.source, run.runId),
      service_date: run.serviceDate,
      route_id: run.routeId,
      scheduled_departure_at: run.scheduledStartAt,
      grace_deadline_at: run.deadlineAt,
      validation_status: "unreviewed",
      detector_version: observation.detectorVersion,
      source_system: run.source,
      source_record_id: run.source === "spare" ? run.runId : null,
      detected_late_arrival_at: null,
      first_seen_watching_at: now,
      evidence_json: evidenceJson(observation.evidence),
    };
    if (fact.kind === "cancellation") {
      return { ...base, status: "escalated", detection_type: "explicit_cancellation", data_quality_status: "source_verified", undecided_reason: null };
    }
    if (fact.kind === "service_failure") {
      return { ...base, status: "escalated", detection_type: fact.detectionType, data_quality_status: "source_verified", undecided_reason: null, detected_late_arrival_at: fact.arrivedAt };
    }
    if (fact.kind === "no_start_by_deadline") {
      return { ...base, status: "watching", detection_type: "silent_no_show", data_quality_status: "experimental", undecided_reason: AWAITING_CONFIRMATION };
    }
    if (fact.kind === "undecidable") {
      return { ...base, status: "watching", detection_type: "silent_no_show", data_quality_status: "unknown_data_gap", undecided_reason: clipReason(fact.reason) };
    }
  }
  return null;
}

// Evidence about a case that exists (or was just opened in this pass).
function applyEvidence(state: CaseState, observations: RunObservation[]): CaseState {
  let next = { ...state };
  const open = () => next.validation_status === "unreviewed" && next.status !== "resolved";
  for (const { fact, detectorVersion, evidence, run } of observations) {
    if (fact.kind === "trip_start" && next.source_system === "gtfs") {
      if (fact.at.getTime() <= next.grace_deadline_at.getTime()) {
        // Timely service: closes an unreviewed case, cancellations included.
        if (open()) next = { ...next, status: "resolved", undecided_reason: null };
        if (next.detected_late_arrival_at === null) next = { ...next, detected_late_arrival_at: fact.at };
      } else {
        if (next.detected_late_arrival_at === null) next = { ...next, detected_late_arrival_at: fact.at };
        // It ran, past its deadline: a missed trip by the 30-minute rule, so a
        // case the detector had not finished deciding is decided.
        if (open() && isHeld(next)) {
          next = {
            ...next,
            status: "escalated",
            undecided_reason: null,
            data_quality_status: next.detection_type === "silent_no_show" ? "experimental" : next.data_quality_status,
          };
        }
      }
    } else if (fact.kind === "service_failure" && next.source_system === "spare") {
      next = {
        ...next,
        route_id: run.routeId,
        scheduled_departure_at: run.scheduledStartAt,
        grace_deadline_at: run.deadlineAt,
        detection_type: fact.detectionType,
        detected_late_arrival_at: fact.arrivedAt,
        detector_version: detectorVersion,
        evidence_json: evidence === undefined ? next.evidence_json : evidenceJson(evidence),
      };
      if (open() && isHeld(next)) next = { ...next, status: "escalated", undecided_reason: null };
    } else if (fact.kind === "no_failure" && next.source_system === "spare") {
      if (open()) next = { ...next, status: "resolved", undecided_reason: null };
    } else if (fact.kind === "evaluation_gap" && next.source_system === "spare") {
      if (open() && !isHeld(next)) next = { ...next, status: "watching", undecided_reason: clipReason(fact.reason) };
    }
  }
  return next;
}

// Item 4 of the false-positive guards: a no-show only becomes a finding when a
// later pass, at least NO_SHOW_CONFIRMATION_SECONDS after it was first held,
// still finds no start.
function applyConfirmation(state: CaseState, observations: RunObservation[], now: Date): CaseState {
  const stillAbsent = observations.some((o) => o.fact.kind === "no_start_by_deadline");
  const heldLongEnough = state.first_seen_watching_at.getTime() <= now.getTime() - NO_SHOW_CONFIRMATION_SECONDS * 1000;
  if (
    stillAbsent && heldLongEnough &&
    state.validation_status === "unreviewed" && state.status === "watching" &&
    state.undecided_reason === AWAITING_CONFIRMATION
  ) {
    return { ...state, status: "escalated", undecided_reason: null };
  }
  return state;
}

const COMPARED: (keyof CaseState)[] = [
  "route_id", "scheduled_departure_at", "grace_deadline_at", "status", "data_quality_status", "detection_type",
  "detector_version", "undecided_reason", "detected_late_arrival_at", "evidence_json",
];

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

export function decideRun(snapshot: CaseState | null, observations: RunObservation[], now: Date): RunDecision | null {
  if (observations.length === 0) return null;
  if (snapshot?.data_quality_status === "legacy_unverified") return null;

  const opened = snapshot ? null : created(observations, now);
  const start = snapshot ?? opened;
  if (!start) return null;

  const decided = applyConfirmation(applyEvidence(start, observations), observations, now);

  if (!snapshot) {
    return { kind: "insert", row: decided, outcome: decided.status === "watching" || isHeld(decided) ? "held" : "created" };
  }

  const set: Partial<CaseState> = {};
  for (const column of COMPARED) {
    if (!same(decided[column], snapshot[column])) (set as Record<string, unknown>)[column] = decided[column];
  }
  if (Object.keys(set).length === 0) return null;

  const outcome: Exclude<DecisionOutcome, "created"> =
    decided.status === "resolved" && snapshot.status !== "resolved" ? "closed_by_evidence"
      : decided.status === "escalated" && snapshot.status !== "escalated" ? "confirmed"
        : decided.status === "watching" && snapshot.status !== "watching" ? "held"
          : "evidence_recorded";
  return { kind: "update", key: { trip_id: snapshot.trip_id, service_date: snapshot.service_date }, expect: { status: snapshot.status, validation_status: snapshot.validation_status }, set, outcome };
}
