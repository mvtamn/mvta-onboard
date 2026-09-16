// When the absence of vehicle-start evidence is allowed to mean "this trip did
// not run" - and when it means something else entirely.
//
// The silent-no-show detector is an inference from absence. That inference is
// only sound while everything it depends on was working: the observing feed,
// the schedule it compares against, and the AVL unit on the bus. Each of those
// failing looks, from inside the detector, exactly like a missed trip - and
// each of them fails for a whole day at a time, so the failure arrives as a
// queue of hundreds of findings no reviewer can disprove. That is the shape of
// false positive this module exists to refuse.
//
// Three guards, each answering a question the earlier one cannot:
//
//   1. Was the observer running?   underwayEvidenceCoverage (kpiTrust.ts) -
//      already applied before this module is consulted.
//   2. Was the schedule current?   staticScheduleConfidence + scheduleAgreement
//      below. A static import that predates a service change leaves trip ids in
//      GtfsScheduledTrips that the realtime feed will never emit, so every one
//      of them is a guaranteed false no-show until the next sync lands.
//   3. Was THIS bus reporting?     blockReportedEvidence below. Feed health is
//      agency-wide; one dead AVL unit is invisible to it and silences an entire
//      block's worth of trips while the feed reads current.
//
// And one confirmation rule: a trip is held for a second poll before it becomes
// a finding, so a single missed fetch, a slow publish or a position that lands a
// few seconds after the deadline cannot raise one on its own.
//
// Every threshold here is a DETECTOR guard, not a feed freshness contract.
// feedFreshness.ts holds the deadlines Operations approved for the trust
// banner; deliberately nothing here writes to those, because a limit chosen to
// keep a detector honest is not a limit anyone has agreed to judge a vendor by.
// The two agreement numbers in particular are first estimates and want
// calibrating against real service days before the precision gate in
// plans/missed-trip-feature-finish-plan.md is claimed.
import type { KpiFeedHealth } from "./kpiTrust";

/**
 * How stale the static GTFS import may be before the schedule stops being
 * evidence of what should have run. The sync runs daily at 09:00 UTC, so this
 * is two consecutive failed syncs - long enough that a single bad morning does
 * not suspend detection, short enough that a service change cannot sit
 * un-imported through a whole week of flagging.
 */
export const STATIC_SCHEDULE_STALE_AFTER_HOURS = 48;

/**
 * How long a detected trip is held before it becomes a finding. The poll runs
 * every five minutes, so anything under one interval guarantees the next run
 * confirms, while nothing in the run that created the row can.
 */
export const NO_SHOW_CONFIRMATION_SECONDS = 240;

/**
 * The share of a day's past-deadline scheduled trips that must be known to at
 * least one realtime feed before absence means anything. A correct schedule on
 * a running day sits near 1; a schedule describing a service pattern the agency
 * no longer runs collapses to near 0, because its trip ids appear in no feed at
 * all.
 */
export const SCHEDULE_AGREEMENT_FLOOR = 0.5;

/**
 * Below this many past-deadline trips the ratio is noise - the first trips of
 * the morning routinely produce a handful of rows - so the agreement test is
 * not applied and the staleness test above stands alone.
 */
export const SCHEDULE_AGREEMENT_MIN_SAMPLE = 20;

export type UndecidedReason =
  | "vehicle_position_feed_not_current"
  | "static_schedule_stale"
  | "schedule_disagrees_with_feed"
  | "block_never_reported";

/** The value stored while a detected trip waits for a second poll to agree. */
export const AWAITING_CONFIRMATION = "awaiting_confirmation";

export type NoShowDecision =
  /** Detected, held for confirmation. Not a finding, and not in the queue. */
  | { outcome: "pending"; reason: typeof AWAITING_CONFIRMATION }
  /** Something other than the trip explains the silence. Recorded, never escalated. */
  | { outcome: "undecidable"; reason: UndecidedReason };

export interface ScheduleConfidence {
  trusted: boolean;
  /** Human-readable, for the poll log - null when trusted. */
  explanation: string | null;
}

/**
 * Whether the imported static schedule is recent enough to describe the service
 * day being judged.
 *
 * Deliberately not resolved through resolveKpiTrust: the gtfs_static contract
 * declares no stale deadline (contract_pending), because none has been approved
 * for the trust banner, and kpiTrust never calls a feed stale on a guess. The
 * detector still needs an answer, so it applies its own - and says so.
 */
export function staticScheduleConfidence(
  records: readonly KpiFeedHealth[],
  now = new Date(),
): ScheduleConfidence {
  const health = records.find((record) => record.feed_name === "gtfs_static");
  const lastSuccess = health?.last_success_at ?? null;
  if (!lastSuccess) {
    return {
      trusted: false,
      explanation: "the static GTFS schedule has no recorded successful import",
    };
  }
  const hoursOld = (now.getTime() - lastSuccess.getTime()) / 3_600_000;
  if (hoursOld > STATIC_SCHEDULE_STALE_AFTER_HOURS) {
    return {
      trusted: false,
      explanation:
        `the static GTFS schedule last imported ${Math.floor(hoursOld)}h ago, ` +
        `beyond the detector's ${STATIC_SCHEDULE_STALE_AFTER_HOURS}h limit`,
    };
  }
  return { trusted: true, explanation: null };
}

export interface ScheduleAgreementInput {
  /** Scheduled trips for this service date whose grace deadline has passed. */
  deadlinePassed: number;
  /** How many of those appeared in ANY realtime feed - TripUpdate or position. */
  knownToFeed: number;
}

/**
 * Whether the day's static schedule and the realtime feeds are describing the
 * same service.
 *
 * This is the guard that catches a stale import the timestamp cannot: a sync
 * that succeeded an hour ago still carries last week's trip ids if the agency
 * published a service change and the feed has not been rebuilt. Rather than
 * trying to learn when service changes happen, it measures the consequence -
 * scheduled trips that no feed has ever heard of.
 *
 * A total realtime outage produces the same reading, and the same answer is
 * right for it: several hundred trips cannot be declared missed on the strength
 * of a day in which nothing was observed at all.
 */
export function scheduleAgreement(input: ScheduleAgreementInput): ScheduleConfidence {
  if (input.deadlinePassed < SCHEDULE_AGREEMENT_MIN_SAMPLE) {
    return { trusted: true, explanation: null };
  }
  const ratio = input.knownToFeed / input.deadlinePassed;
  if (ratio < SCHEDULE_AGREEMENT_FLOOR) {
    return {
      trusted: false,
      explanation:
        `only ${input.knownToFeed} of ${input.deadlinePassed} scheduled trips past their deadline ` +
        `appeared in any realtime feed (${Math.round(ratio * 100)}%, floor ` +
        `${Math.round(SCHEDULE_AGREEMENT_FLOOR * 100)}%) - the static schedule and the feeds disagree`,
    };
  }
  return { trusted: true, explanation: null };
}

export interface NoShowEvidenceContext {
  /** underwayEvidenceCoverage said gtfs_vehicle_positions is current. */
  vehiclePositionsCurrent: boolean;
  /** staticScheduleConfidence for this run. */
  staticSchedule: ScheduleConfidence;
  /** scheduleAgreement for this service date. */
  agreement: ScheduleConfidence;
  /**
   * Whether any vehicle position arrived for any trip on this trip's block
   * today. `null` when the trip carries no block_id, which is not evidence
   * either way - an older static import predates the column.
   */
  blockReported: boolean | null;
}

/**
 * The verdict on one scheduled trip that reached its grace deadline with no
 * qualifying underway evidence.
 *
 * Note what is NOT here: an "escalate" outcome. Every fresh detection is
 * pending, and only the confirmation pass - a later poll that finds the trip
 * still unevidenced - turns one into a finding. Detection and confirmation are
 * separate observations on purpose; one poll's view of a feed is not a fact
 * about the road.
 *
 * Order matters. The broadest explanation wins, because a stale schedule makes
 * the block question meaningless: the block's trips were never going to appear
 * under those ids whatever the buses did.
 */
export function noShowDecision(context: NoShowEvidenceContext): NoShowDecision {
  if (!context.vehiclePositionsCurrent) {
    return { outcome: "undecidable", reason: "vehicle_position_feed_not_current" };
  }
  if (!context.staticSchedule.trusted) {
    return { outcome: "undecidable", reason: "static_schedule_stale" };
  }
  if (!context.agreement.trusted) {
    return { outcome: "undecidable", reason: "schedule_disagrees_with_feed" };
  }
  // A whole block silent all day is either a bus that never left the garage or
  // an AVL unit that never reported, and GTFS cannot tell those apart. The
  // first is real and serious - and it is already detected by the source that
  // CAN tell them apart: Avail pullout, which knows whether an operator logged
  // in, raises it as a Missed Pullout through fixedRouteDepartureOutcome.ts. So
  // holding it here costs nothing that is not caught elsewhere, and spares the
  // queue an entire block's worth of trips every time a transponder dies.
  if (context.blockReported === false) {
    return { outcome: "undecidable", reason: "block_never_reported" };
  }
  return { outcome: "pending", reason: AWAITING_CONFIRMATION };
}

/** Whether a held row has waited long enough for a later poll to confirm it. */
export function confirmationDue(firstSeenAt: Date, now = new Date()): boolean {
  return now.getTime() - firstSeenAt.getTime() >= NO_SHOW_CONFIRMATION_SECONDS * 1000;
}
