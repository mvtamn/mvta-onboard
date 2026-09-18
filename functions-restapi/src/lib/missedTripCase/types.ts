// Vocabulary of the Missed-trip case module (CONTEXT.md "Missed-trip language").
// Callers speak these terms; how they map onto MonitoredMissedTrips' columns is
// the module's business (decide.ts, classify.ts, store.ts).

export type MissedTripSource = "gtfs" | "spare" | "avail";

// A detector family. Promotion out of Shadow detection is granted per family,
// from a service date, and recorded in the promotion history (promotion.ts); a
// new detector version stays promoted or not with its family.
export const MISSED_TRIP_DETECTORS = ["gtfs_cancellation", "gtfs_silent_no_show", "spare"] as const;

// How strongly a record from another system is tied to a Scheduled-run
// identity. Avail names no trip, so the link is built from route, service date
// and Published Trip start. A probable link is recorded and shown but changes
// nothing until a reviewer confirms it (ADR-0035).
export const EVIDENCE_MATCH_CONFIDENCE = ["exact", "probable", "unmatched"] as const;
export type EvidenceMatchConfidence = (typeof EVIDENCE_MATCH_CONFIDENCE)[number];
export type MissedTripDetector = (typeof MISSED_TRIP_DETECTORS)[number];

// One scheduled run on one service date, as a source names it.
export interface RunRef {
  source: MissedTripSource;
  // GTFS trip_id, or the Spare request id.
  runId: string;
  // Agency-local YYYYMMDD.
  serviceDate: string;
  routeId: string;
  scheduledStartAt: Date;
  // Published Trip start + 30 minutes.
  deadlineAt: Date;
  // The scheduled final-stop time + 30 minutes: the end of the Expected
  // operating window. GTFS silent no-shows only; null when the schedule does
  // not say (the case then stays Awaiting evidence).
  operatingWindowEndAt?: Date | null;
}

// What a source observed about a run. Facts do not say what should happen to
// a case; the module decides that, the same way for every source.
export type RunFact =
  // GTFS-RT: the agency's own dispatch cancelled the trip.
  | { kind: "cancellation" }
  // GTFS: past its deadline with no trip start, and the detector could decide.
  | { kind: "no_start_by_deadline" }
  // GTFS: past its deadline with no trip start, and the detector could not
  // decide why (reason from missedTripConfidence.ts).
  | { kind: "undecidable"; reason: string }
  // GTFS: Qualifying progress evidence that the run started.
  | { kind: "trip_start"; at: Date }
  // Spare: a retrospective evaluation found a failure.
  | { kind: "service_failure"; detectionType: SpareDetectionType; arrivedAt: Date | null }
  // Spare: a later evaluation found no failure.
  | { kind: "no_failure" }
  // Spare: the evaluation could not decide. Holds an existing case; never
  // creates one.
  | { kind: "evaluation_gap"; reason: string }
  // Avail: its retrospective report says the whole run did not operate.
  // Corroborates a case; never opens one (ADR-0035).
  | { kind: "retrospective_missed" }
  // Avail: the run operated but missed a scheduled stop - a Partial-service
  // failure, not a whole missed trip.
  | { kind: "retrospective_partial"; missedDeparture: boolean; missedArrival: boolean };

export type SpareDetectionType = "spare_late_start" | "spare_superseded" | "spare_late_arrival" | "spare_multiple";

export interface RunObservation {
  run: RunRef;
  detectorVersion: string;
  fact: RunFact;
  // Source evidence kept with the case; readers never interpret it.
  evidence?: unknown;
}

export interface ObserveReport {
  created: number;
  held: number;
  confirmed: number;
  closedByEvidence: number;
  evidenceRecorded: number;
  // Rows another writer changed between read and write; retried next run.
  skippedChanged: number;
  failed: { runId: string; serviceDate: string; error: unknown }[];
}

export type MissedTripLifecycle =
  | "open"
  | "awaiting_evidence"
  | "ready_for_review"
  | "closed_by_evidence"
  | "reviewed"
  | "legacy";

export type MissedTripEvidenceFinding =
  | "advance_cancellation"
  | "suspected_no_show"
  | "late_trip_start"
  | "on_demand_service_failure"
  | "timely_service"
  | "indeterminate";

export type MissedTripReviewOutcome = "confirmed_missed_trip" | "timely_service" | "partial_service_failure" | "indeterminate";

// validation_status as stored. `false_positive` predates migration 125 and is
// read as Timely service.
export type StoredReviewOutcome = "confirmed" | "timely_service" | "partial_service_failure" | "indeterminate";

export interface MissedTripClassification {
  lifecycle: MissedTripLifecycle;
  evidence_finding: MissedTripEvidenceFinding;
  review_outcome: MissedTripReviewOutcome | null;
  detector: MissedTripDetector;
  // Why a case is Awaiting evidence; null otherwise.
  held_reason: string | null;
  legacy: boolean;
  held: boolean;
  in_queue: boolean;
  // A review or evidence has concluded it (history view).
  concluded: boolean;
  // Ready for review or Confirmed missed trip: what live operations show as
  // missed (Dispatch Log). Never held, closed, legacy, or Timely service.
  flagged_missed: boolean;
  // A Confirmed missed trip.
  counts_as_missed: boolean;
  // Two exact-matched sources support incompatible findings. Never resolved by
  // an undocumented source priority: it waits for a reviewer, and blocks
  // Assessment promotion meanwhile (ADR-0035).
  evidence_conflict: boolean;
  // A Confirmed missed trip from a detector out of Shadow detection, with no
  // unresolved Evidence conflict.
  counts_toward_assessment: boolean;
}

export type Actor = { kind: "person"; name: string };

// A case as the review queue lists it: MonitoredMissedTrips' trip_id (for Spare,
// "spare:" + request id) and service date.
export type CaseKey = { tripId: string; serviceDate: string };

interface ReviewFields {
  outcome: StoredReviewOutcome;
  reasonCode: string;
  notes: string | null;
  attribution: "contractor_error" | "excusable" | "mvta_directed" | "undetermined";
}

export type CaseAct =
  // The first review of a case.
  | ({ act: "record_review" } & ReviewFields)
  // A Superseding missed-trip review: replaces an earlier outcome, which the
  // history keeps, and says why.
  | ({ act: "supersede_review"; reason: string } & ReviewFields)
  // The explicit rereview a Legacy missed-trip record needs before it can be
  // anything but legacy.
  | ({ act: "rereview_legacy"; reason: string } & ReviewFields);

export type CaseRefusalCode =
  | "not_found"
  | "already_reviewed"
  | "not_reviewed"
  | "legacy_record"
  | "not_legacy"
  | "reason_required"
  | "awaiting_evidence";

export interface CaseRefusal {
  code: CaseRefusalCode;
  sentence: string;
}
