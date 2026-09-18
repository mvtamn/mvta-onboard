// What the missed-trip review panel says and allows, from the classification
// the API returns (lifecycle, finding, outcome). The rules themselves live in
// the Missed-trip case module; this only turns them into words and requests.
import type { GtfsRouteOption, MissedTripReviewDecision, MissedTripSourceSystem, MissedTripsMonthlySummaryRow, MissedTripValidationStatus, OccurrenceAttribution, ValidateMissedTripInput } from "@mvta/shared";
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

// ---------------------------------------------------------------------------
// What the console calls a case.
//
// These moved out of MissedTripAlerts.tsx, where they were private to a
// 1253-line page module and therefore untestable: half the vocabulary was
// here and tested, the other half was rendering-adjacent and was not. A word
// the console puts on a case is this module's business either way.
// ---------------------------------------------------------------------------

// "Is there any way to determine why the flag exists?" - added by
// migration-023. Rows flagged before that migration ran read back null;
// shown honestly rather than guessed.
export function detectionTypeLabel(type: MissedTripAlert["detectionType"]): string {
  if (type === "explicit_cancellation") return "Explicit cancellation (GTFS-RT)";
  if (type === "silent_no_show") return "Scheduled no-show (never observed)";
  if (type === "spare_late_start") return "Spare pickup started over 30 minutes late";
  if (type === "spare_superseded") return "Spare request superseded by the next same-duty pickup";
  if (type === "spare_late_arrival") return "Spare dropoff arrived at least 30 minutes late";
  if (type === "spare_multiple") return "Multiple Spare missed-trip conditions";
  return "Unknown — flagged before detection tracking was added";
}

export function dataQualityLabel(status: MissedTripAlert["dataQualityStatus"]): string {
  if (status === "source_verified") return "Source verified";
  if (status === "experimental") return "Experimental detector";
  return "Legacy — unverified";
}

export function sourceLabel(source: MissedTripAlert["sourceSystem"]): string {
  return source === "spare" ? "Spare" : "GTFS-Realtime";
}

export function routeLabel(routeId: string, routesById: Map<string, GtfsRouteOption>, sourceSystem: "gtfs" | "spare" = "gtfs"): string {
  if (sourceSystem === "spare") return `Spare · ${routeId}`;
  const r = routesById.get(routeId);
  const shortName = r?.route_short_name?.trim();
  const longName = r?.route_long_name?.trim();
  // route_short_name is the same string as route_id for MVTA's numbered
  // routes (e.g. both "420") - appending it back on would just read as
  // "Route 420 · 420". Fall through to route_long_name (the actual
  // descriptive name) whenever short_name doesn't add anything beyond the
  // number already shown.
  const name = shortName && shortName !== routeId ? shortName : longName;
  return name ? `Route ${routeId} · ${name}` : `Route ${routeId}`;
}

// Trip identifier the way staff actually recognize it - scheduled departure
// time + direction (e.g. "1245-SB"), the same time+direction convention
// Avail's own reports use for their "Trip" column - not the raw GTFS
// trip_id (e.g. "t52C-b2E-sl2B-v62"), which is an opaque static-feed key
// that means nothing to a reviewer scanning a list. Falls back to whichever
// half is available if the other is missing (direction_label can be null -
// see GtfsTripDirections' migration-007 comment).
export function tripCode(scheduledDepartureAt: string | null, direction: string | null): string {
  const time = scheduledDepartureAt ? new Date(scheduledDepartureAt) : null;
  const timePart =
    time && !Number.isNaN(time.getTime())
      ? `${String(time.getHours()).padStart(2, "0")}${String(time.getMinutes()).padStart(2, "0")}`
      : null;
  if (timePart && direction) return `${timePart}-${direction}`;
  return timePart ?? direction ?? "—";
}

// "YYYYMM" -> "MM/YYYY" - a small local duplicate of the same helper OTP's
// module keeps for itself (otp/OtpModule.tsx's formatServiceMonth); this
// module isn't otherwise coupled to OTP's code, so it gets its own copy
// rather than importing across unrelated console modules for two lines.
export function formatServiceMonth(yyyymm: string): string {
  if (!/^\d{6}$/.test(yyyymm)) return yyyymm;
  return `${yyyymm.slice(4, 6)}/${yyyymm.slice(0, 4)}`;
}

// Missed Trips feeds the Contractor Performance Assessment's MISSED_TRIPS_FR
// KPI once a reviewer confirms a row (plans/ContractorPerformanceAssessment_
// Design.md SS3/SS6 - "Auto-candidate from MonitoredMissedTrips
// (validation_status='confirmed')") - and that assessment computes on a
// monthly, per-contractor-month cadence. An unreviewed trip sitting for days
// isn't just clutter in this queue: if it slips past its service month's
// assessment period before anyone reviews it, catching it later means
// reopening an already-finalized period, which the design treats as a
// deliberate manager decision, not a side effect. Age is measured from
// firstSeenWatchingAt (when the row was first flagged), not from now vs.
// scheduled time, since that's when the review clock actually starts.
export const AGING_HOURS = 24;
export const OVERDUE_HOURS = 72;

function reviewAgeHours(firstSeenWatchingAt: string): number | null {
  const date = new Date(firstSeenWatchingAt);
  return Number.isNaN(date.getTime()) ? null : (Date.now() - date.getTime()) / 3_600_000;
}

// Only unreviewed rows carry review urgency - once a reviewer has acted
// there's nothing left pending, however old the row is.
export function agingBadge(alert: MissedTripAlert): { label: string; className: string } | null {
  if (alert.validationStatus !== "unreviewed") return null;
  const hours = reviewAgeHours(alert.firstSeenWatchingAt);
  if (hours === null) return null;
  if (hours >= OVERDUE_HOURS) return { label: "Overdue", className: "pill-danger" };
  if (hours >= AGING_HOURS) return { label: "Aging", className: "pill-warning" };
  return null;
}


// What a reviewed trip's assessment state is, in the reviewer's words. This is
// the answer to "where did my decision go", which the module could not
// previously give: confirming a trip raised nothing visible, and the occurrence
// it eventually produced lived in a different module behind a second review.
export function assessmentOutcome(alert: MissedTripAlert): { label: string; detail: string; tone: "counted" | "pending" | "excluded" } | null {
  if (alert.validationStatus === "unreviewed") return null;
  // The Assessment evidence gate (ADR-0035) holds this out whatever the review
  // said, so saying "Counted" here would be untrue of the server.
  if (alert.evidenceConflict) {
    return {
      label: "Held — sources disagree",
      detail: "Another source contradicts this outcome, so it is kept out of the performance assessment until the disagreement is settled.",
      tone: "pending",
    };
  }
  const month = alert.occurrenceServiceMonth ? formatServiceMonth(alert.occurrenceServiceMonth) : formatServiceMonth(alert.serviceDate.slice(0, 6));
  if (alert.validationStatus !== "confirmed") {
    // Stored as `timely_service`, `partial_service_failure` or `indeterminate`
    // since migration 125 (`false_positive` before it): none is a missed trip.
    return { label: "Not assessed", detail: "Reviewed as not a missed trip, so there is nothing to charge.", tone: "excluded" };
  }
  if (!alert.occurrenceReviewStatus) {
    return {
      label: "Not linked",
      detail: `Confirmed, but no performance-assessment occurrence exists for ${month}. The service date may fall outside the active Agreement, or the month may already be finalized.`,
      tone: "pending",
    };
  }
  if (alert.occurrenceReviewStatus === "candidate") {
    return { label: "Awaiting attribution", detail: `Raised against the ${month} assessment, waiting on whose error it was before it can be charged.`, tone: "pending" };
  }
  if (alert.occurrenceReviewStatus === "dismissed") {
    const because = alert.occurrenceAttribution === "excusable" ? "an excusable delay"
      : alert.occurrenceAttribution === "mvta_directed" ? "MVTA-directed" : "dismissed on review";
    return { label: "Recorded, not charged", detail: `In the ${month} assessment as ${because}, so it carries no penalty.`, tone: "excluded" };
  }
  const finalized = alert.occurrencePeriodStatus === "finalized" || alert.occurrencePeriodStatus === "issued";
  return {
    label: `Counted in ${month}`,
    detail: finalized
      ? `Charged to the contractor in the ${month} assessment, which is now ${alert.occurrencePeriodStatus}.`
      : `Charged to the contractor in the ${month} assessment. The period recomputes to include it.`,
    tone: "counted",
  };
}

// ---------------------------------------------------------------------------
// Evidence conflict (ADR-0035).
//
// Two exact-matched sources support incompatible findings. The case keeps its
// own outcome - a conflict is not a lifecycle and does not reopen anything -
// but it blocks the performance assessment until a reviewer settles it, which
// they do by recording a review having seen both sources.
// ---------------------------------------------------------------------------

export interface ConflictNotice {
  label: string;
  /** What disagreed, as the server recorded it. */
  detail: string;
  /** What the reviewer is being asked to do about it. */
  action: string;
}

const CONFLICT_FALLBACK = "Two sources disagree about whether this run operated.";

export function conflictNotice(
  alert: Pick<MissedTripAlert, "evidenceConflict" | "evidenceConflictReason" | "validationStatus">,
): ConflictNotice | null {
  if (!alert.evidenceConflict) return null;
  return {
    label: "Sources disagree",
    detail: alert.evidenceConflictReason?.trim() || CONFLICT_FALLBACK,
    action: alert.validationStatus === "unreviewed"
      ? "Review it with both sources in front of you. Until then it stays out of the performance assessment."
      : "Change the review if the other source is right. Until this is settled it stays out of the performance assessment.",
  };
}

// A conflicted case is held out of the assessment whatever its outcome, so the
// assessment line has to say that rather than the outcome it would otherwise
// have had.
export function conflictBlocksAssessment(
  alert: Pick<MissedTripAlert, "evidenceConflict">,
): boolean {
  return alert.evidenceConflict;
}
