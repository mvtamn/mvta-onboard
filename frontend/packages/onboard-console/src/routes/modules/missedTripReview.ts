// What the missed-trip review panel says and allows, from the classification
// the API returns (lifecycle, finding, outcome). The rules themselves live in
// the Missed-trip case module; this only turns them into words and requests.
import type { MissedTripReviewDecision, MissedTripSourceSystem, MissedTripsMonthlySummaryRow, MissedTripValidationStatus, OccurrenceAttribution, ValidateMissedTripInput } from "@mvta/shared";
import type { MissedTripAlert } from "./missedTrips.data.js";

export const REVIEW_DECISIONS: { value: MissedTripReviewDecision; label: string; hint: string }[] = [
  { value: "confirmed", label: "Confirmed missed trip", hint: "It did not run, or started more than 30 minutes late." },
  { value: "timely_service", label: "Timely service", hint: "It started no more than 30 minutes late." },
  { value: "partial_service_failure", label: "Partial-service failure", hint: "It ran but missed part of its scheduled service, such as its first stop." },
  { value: "indeterminate", label: "Indeterminate", hint: "The evidence cannot establish either way." },
];

export function outcomeLabel(status: MissedTripValidationStatus): string {
  switch (status) {
    case "unreviewed": return "Unreviewed";
    case "confirmed": return "Confirmed missed trip";
    case "timely_service":
    case "false_positive": return "Timely service";
    case "partial_service_failure": return "Partial-service failure";
    case "indeterminate": return "Indeterminate";
  }
}

export function outcomeClass(status: MissedTripValidationStatus): string {
  if (status === "unreviewed") return "pill-warning";
  if (status === "confirmed") return "pill-danger";
  return "pill-muted";
}

const HELD_REASONS: Record<string, string> = {
  awaiting_confirmation: "Waiting for a second check to agree",
  awaiting_operating_window: "Waiting for the trip's scheduled run to end",
  unknown_data_gap: "The vehicle data could not decide it",
  vehicle_position_feed_not_current: "Vehicle positions were not current",
  static_schedule_stale: "The schedule import is out of date",
  schedule_disagrees_with_feed: "The schedule does not match the live feeds",
  block_never_reported: "No vehicle on this block reported",
  block_ran_around_this_trip: "The block's bus was working around this trip",
};

export function heldReasonLabel(reason: string | null): string {
  if (!reason) return "Awaiting evidence";
  return HELD_REASONS[reason] ?? `Awaiting evidence (${reason.replace(/_/g, " ")})`;
}

// Where the case stands, in one pill.
export function lifecycleLabel(alert: Pick<MissedTripAlert, "lifecycle" | "validationStatus">): string {
  switch (alert.lifecycle) {
    case "open": return "Watching";
    case "awaiting_evidence": return "Awaiting evidence";
    case "ready_for_review": return "Potential missed";
    case "closed_by_evidence": return "Operated within window";
    case "reviewed": return alert.validationStatus === "confirmed" ? "Missed" : outcomeLabel(alert.validationStatus);
    case "legacy": return "Legacy record";
  }
}

export function lifecycleClass(alert: Pick<MissedTripAlert, "lifecycle" | "validationStatus">): string {
  if (alert.lifecycle === "closed_by_evidence") return "pill-success";
  if (alert.lifecycle === "reviewed") return alert.validationStatus === "confirmed" ? "pill-danger" : "pill-muted";
  if (alert.lifecycle === "legacy") return "pill-muted";
  return "pill-warning";
}

export function findingLabel(finding: MissedTripAlert["evidenceFinding"]): string {
  switch (finding) {
    case "advance_cancellation": return "Cancelled by dispatch";
    case "suspected_no_show": return "No start observed by the deadline";
    case "late_trip_start": return "Started more than 30 minutes late";
    case "on_demand_service_failure": return "On-demand service failure";
    case "timely_service": return "Evidence shows it ran on time";
    case "indeterminate": return "Evidence could not decide";
  }
}

// The queue and history the page lists; the same split the API's view uses.
export function inView(alert: Pick<MissedTripAlert, "inQueue" | "concluded">, mode: "queue" | "history"): boolean {
  return mode === "queue" ? alert.inQueue : alert.concluded;
}

export type ReviewMode = "review" | "supersede" | "rereview";

export function reviewMode(alert: Pick<MissedTripAlert, "lifecycle" | "validationStatus">): ReviewMode {
  if (alert.lifecycle === "legacy") return "rereview";
  return alert.validationStatus === "unreviewed" ? "review" : "supersede";
}

// Why a case cannot be confirmed yet, or null when it can.
export function confirmBlockedReason(alert: Pick<MissedTripAlert, "lifecycle" | "heldReason">): string | null {
  if (alert.lifecycle === "open" || alert.lifecycle === "awaiting_evidence") {
    return `Not ready to confirm: ${heldReasonLabel(alert.heldReason).toLowerCase()}.`;
  }
  return null;
}

export interface ReviewDrafts {
  reasonCode: string;
  notes: string;
  attribution: OccurrenceAttribution;
  changeReason: string;
}

export function buildReviewRequest(
  alert: Pick<MissedTripAlert, "tripId" | "serviceDate" | "lifecycle" | "validationStatus" | "heldReason">,
  decision: MissedTripReviewDecision,
  drafts: ReviewDrafts,
): { input: ValidateMissedTripInput } | { error: string } {
  if (!drafts.reasonCode) return { error: "Select a reason before saving the review." };
  const mode = reviewMode(alert);
  const changeReason = drafts.changeReason.trim();
  if (mode !== "review" && !changeReason) {
    return { error: mode === "supersede" ? "Say why the earlier review is being changed." : "Say why this legacy record is being rereviewed." };
  }
  if (decision === "confirmed" && mode === "review") {
    const blocked = confirmBlockedReason(alert);
    if (blocked) return { error: blocked };
  }
  return {
    input: {
      trip_id: alert.tripId,
      service_date: alert.serviceDate,
      validation_status: decision,
      reason_code: drafts.reasonCode,
      notes: drafts.notes || undefined,
      attribution: decision === "confirmed" ? drafts.attribution : undefined,
      ...(mode === "supersede" ? { supersede_reason: changeReason } : {}),
      ...(mode === "rereview" ? { rereview_reason: changeReason } : {}),
    },
  };
}

// The monthly table's rows, summed from what the server classified.
//
// Every bucket here is a column the Missed-trip case module emits
// (counts_as_missed, review_outcome, lifecycle). The console used to read the
// stored validation_status and decide for itself which values meant confirmed
// and which meant timely service - carrying `false_positive`, the name that
// outcome had before migration 125, as a second spelling the module had
// already retired.
export interface MissedTripMonthlyRow {
  service_month: string;
  route_id: string;
  source_system: MissedTripSourceSystem;
  cancellations: number;
  noShows: number;
  spareCandidates: number;
  /** Confirmed missed trips: what the month counts. */
  confirmedMissed: number;
  /** Of those, the ones from a detector out of Shadow detection. */
  countingTowardAssessment: number;
  timelyService: number;
  /** Partial-service failure or indeterminate: reviewed, not counted. */
  otherOutcome: number;
  awaitingReview: number;
  total: number;
}

export function pivotMonthlySummary(summary: MissedTripsMonthlySummaryRow[]): MissedTripMonthlyRow[] {
  const byKey = new Map<string, MissedTripMonthlyRow>();
  for (const r of summary) {
    const key = `${r.service_month}-${r.source_system}-${r.route_id}`;
    const row = byKey.get(key) ?? {
      service_month: r.service_month,
      route_id: r.route_id,
      source_system: r.source_system,
      cancellations: 0, noShows: 0, spareCandidates: 0,
      confirmedMissed: 0, countingTowardAssessment: 0,
      timelyService: 0, otherOutcome: 0, awaitingReview: 0, total: 0,
    };
    if (r.detector === "gtfs_cancellation") row.cancellations += r.trip_count;
    if (r.detector === "gtfs_silent_no_show") row.noShows += r.trip_count;
    if (r.detector === "spare") row.spareCandidates += r.trip_count;
    if (r.counts_as_missed) row.confirmedMissed += r.trip_count;
    if (r.counts_toward_assessment) row.countingTowardAssessment += r.trip_count;
    if (r.review_outcome === "timely_service") row.timelyService += r.trip_count;
    if (r.review_outcome === "partial_service_failure" || r.review_outcome === "indeterminate") row.otherOutcome += r.trip_count;
    if (r.lifecycle === "ready_for_review") row.awaitingReview += r.trip_count;
    row.total += r.trip_count;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort(
    (a, b) => b.service_month.localeCompare(a.service_month) || a.route_id.localeCompare(b.route_id, undefined, { numeric: true }),
  );
}
