// The top of a missed-trip case, in the order a reviewer reasons: what was
// scheduled, what we saw, what that looks like, and whether a confirmation is
// charged. One shape for a fixed-route and an on-demand case, so the two read
// the same; the source, detector and version fold away under Technical details.
//
// "Looks like" is a reading of the evidence for the reviewer. It decides
// nothing: the case's lifecycle and the review stay where they were, and a
// reviewer who disagrees records the outcome they find.
import type { SpareCaseTimes } from "@mvta/shared";
import { detectionTypeLabel, dataQualityLabel, findingLabel, sourceLabel } from "./missedTripReview.js";
import type { MissedTripAlert } from "./missedTrips.data.js";

export type LooksLikeTone = "missed" | "ran" | "check";

export interface CaseHeader {
  /** "Scheduled" for a fixed-route trip, "Booked" for an on-demand request. */
  scheduledLabel: string;
  scheduled: string[];
  seen: string[];
  looksLike: { text: string; tone: LooksLikeTone; caution?: string };
  /** Null when the API is too old to say whether the detector is promoted. */
  counting: string | null;
  details: { label: string; value: string }[];
}

type Time = (iso: string | null) => string;

type HeaderAlert = Pick<MissedTripAlert,
  | "sourceSystem" | "detectionType" | "evidenceFinding" | "dataQualityStatus" | "detectorVersion"
  | "scheduledDepartureAt" | "graceDeadlineAt" | "firstSeenWatchingAt" | "detectedLateArrivalAt" | "tripId"
  | "startDelaySeconds" | "arrivalDelaySeconds" | "gtfsEvidence" | "spareTimes" | "detectorPromoted">;

function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.trunc((b - a) / 60_000);
}

function lateness(minutes: number): string {
  if (minutes === 0) return "on time";
  return minutes > 0 ? `${minutes} min late` : `${-minutes} min early`;
}

const DETECTOR_NAME: Record<"gtfs_cancellation" | "gtfs_silent_no_show" | "spare", string> = {
  gtfs_cancellation: "Advance cancellation",
  gtfs_silent_no_show: "Suspected no-show",
  spare: "On-demand",
};

function detectorOf(alert: Pick<MissedTripAlert, "sourceSystem" | "detectionType">): keyof typeof DETECTOR_NAME {
  if (alert.sourceSystem === "spare") return "spare";
  return alert.detectionType === "explicit_cancellation" ? "gtfs_cancellation" : "gtfs_silent_no_show";
}

export function countingLine(alert: Pick<MissedTripAlert, "sourceSystem" | "detectionType" | "detectorPromoted">): string | null {
  if (alert.detectorPromoted === undefined) return null;
  const name = DETECTOR_NAME[detectorOf(alert)];
  return alert.detectorPromoted
    ? `The ${name} detector counts toward assessments: a confirmation is charged once a manager attributes it to the contractor.`
    : `The ${name} detector is in Shadow detection: a confirmation is recorded, not charged.`;
}

// ---------------------------------------------------------------------------
// Fixed route
// ---------------------------------------------------------------------------

function gtfsLooksLike(alert: HeaderAlert): CaseHeader["looksLike"] {
  if (alert.evidenceFinding === "advance_cancellation") {
    return { text: "Cancelled by dispatch before it ran.", tone: "missed" };
  }
  const evidence = alert.gtfsEvidence;
  if (!evidence) {
    if (alert.evidenceFinding === "late_trip_start") return { text: "Started more than 30 minutes late.", tone: "missed" };
    if (alert.evidenceFinding === "indeterminate") return { text: "The evidence could not decide.", tone: "check" };
    if (alert.evidenceFinding === "timely_service") return { text: "Evidence shows it started inside the 30 minutes.", tone: "ran" };
    return { text: "No start seen by the deadline.", tone: "check" };
  }

  if (evidence.started_at && evidence.started_late_minutes !== null) {
    return evidence.started_inside_grace
      ? { text: "Started inside the 30 minutes. Looks like timely service.", tone: "ran" }
      : { text: `Started ${evidence.started_late_minutes} min late. Looks like a missed trip (late start).`, tone: "missed" };
  }

  const busOnTrip = Boolean(evidence.vehicle.reported_at);
  const deadZone = evidence.origin_stop?.likely_dead_zone === true;
  const block = evidence.block && evidence.block.trips > 0 ? evidence.block : null;
  const check = "Check before confirming.";

  if (busOnTrip) {
    return deadZone
      ? { text: "The bus signed in but was never seen past a first stop where buses often go quiet. It may have run without reporting.", tone: "check", caution: check }
      : { text: "The bus signed in but was never seen leaving the first stop. Looks like a missed trip.", tone: "missed" };
  }
  if (block && block.trips_reported === 0) {
    return { text: `No bus reported on this trip or anywhere on Block ${block.block_id}. Looks like the block did not run, unless its bus was not logged in.`, tone: "missed" };
  }
  if (block && block.trips_reported > 0) {
    return { text: `No start seen, but Block ${block.block_id}'s bus was working. It may have run without reporting.`, tone: "check", caution: check };
  }
  if (deadZone) {
    return { text: "No start seen, at a first stop where buses often go quiet. It may have run without reporting.", tone: "check", caution: check };
  }
  return { text: "No start seen and no bus reported. Looks like a missed trip.", tone: "missed" };
}

function gtfsSeen(alert: HeaderAlert, time: Time, evidenceUnavailable: boolean): string[] {
  if (alert.evidenceFinding === "advance_cancellation") return ["Cancelled in the realtime feed."];
  const evidence = alert.gtfsEvidence;
  if (!evidence) {
    if (evidenceUnavailable) return ["The start evidence could not be read just now. Reload before deciding."];
    return [alert.detectedLateArrivalAt ? `First seen past the first stop ${time(alert.detectedLateArrivalAt)}` : "Not seen past the first stop."];
  }
  const lines: string[] = [];
  if (evidence.started_at && evidence.started_late_minutes !== null) {
    lines.push(`Left the first stop ${time(evidence.started_at)} (${lateness(evidence.started_late_minutes)})`);
  } else {
    lines.push("No departure recorded in the Dispatch Log.");
  }
  const { vehicle } = evidence;
  if (vehicle.reported_at) {
    const bus = vehicle.vehicle_id ? `Bus ${vehicle.vehicle_id}` : "A bus";
    const after = minutesBetween(alert.scheduledDepartureAt, vehicle.reported_at);
    const relative = after === null ? "" : after > 0 ? ` (${after} min after the scheduled start)` : after < 0 ? ` (${-after} min before the scheduled start)` : " (at the scheduled start)";
    lines.push(`${bus} signed in ${time(vehicle.reported_at)}${relative}.`);
  } else {
    lines.push("No bus reported on this trip.");
  }
  if (!evidence.started_at && evidence.block && evidence.block.trips > 0) {
    lines.push(`Block ${evidence.block.block_id}'s bus reported on ${evidence.block.trips_reported} of its ${evidence.block.trips} trips.`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// On demand
// ---------------------------------------------------------------------------

// A promised time and, when Spare re-planned it, where it moved to.
function promised(label: string, original: string | null, scheduled: string | null, time: Time): string | null {
  const first = original ?? scheduled;
  if (!first) return null;
  const moved = original && scheduled ? minutesBetween(original, scheduled) : null;
  return moved !== null && moved !== 0 ? `${label} ${time(original)}, moved to ${time(scheduled)}` : `${label} ${time(first)}`;
}

// Spare's lateness figure is its own; when it matches neither of the times the
// case shows, the reviewer cannot check it here and is told so rather than
// left to subtract.
function matchesEither(seconds: number, arrived: string | null, ...against: (string | null)[]): boolean {
  if (!arrived) return true;
  const at = new Date(arrived).getTime();
  const candidates = against.filter((t): t is string => Boolean(t)).map((t) => (at - new Date(t).getTime()) / 1000);
  if (candidates.length === 0) return true;
  return candidates.some((diff) => Math.abs(diff - seconds) <= 120);
}

function spareLooksLike(alert: HeaderAlert, times: SpareCaseTimes | null): CaseHeader["looksLike"] {
  const mismatch = (seconds: number | null, arrived: string | null, original: string | null, scheduled: string | null) =>
    seconds !== null && !matchesEither(seconds, arrived, original, scheduled)
      ? `Spare's ${Math.round(seconds / 60)} min doesn't match the times above. Check the request in Spare.`
      : undefined;
  switch (alert.detectionType) {
    case "spare_late_arrival":
      return {
        text: "Late dropoff (30 min or more). Under the on-demand agreement this counts as a missed trip.",
        tone: "missed",
        caution: mismatch(alert.arrivalDelaySeconds, times?.dropoff_arrived_at ?? null, times?.original_dropoff_at ?? null, times?.scheduled_dropoff_at ?? null),
      };
    case "spare_late_start":
      return {
        text: "Late pickup (more than 30 min). This counts as a missed trip.",
        tone: "missed",
        caution: mismatch(alert.startDelaySeconds, times?.pickup_arrived_at ?? null, times?.original_pickup_at ?? null, times?.scheduled_pickup_at ?? null),
      };
    case "spare_superseded":
      return { text: "Superseded by the next pickup on the same duty, so the rider was not served as booked.", tone: "missed" };
    case "spare_multiple":
      return { text: "More than one on-demand failure on this request.", tone: "missed" };
    default:
      return { text: findingLabel(alert.evidenceFinding), tone: "check" };
  }
}

function spareSeen(alert: HeaderAlert, times: SpareCaseTimes | null, time: Time): string[] {
  const pickup = times?.pickup_arrived_at ?? alert.detectedLateArrivalAt;
  const dropoff = times?.dropoff_arrived_at ?? null;
  const lines = [[
    pickup ? `Picked up ${time(pickup)}` : "Pickup arrival not recorded",
    dropoff ? `dropped off ${time(dropoff)}` : "dropoff arrival not recorded",
  ].join(" · ")];
  if (alert.arrivalDelaySeconds !== null && (alert.detectionType === "spare_late_arrival" || alert.detectionType === "spare_multiple")) {
    lines.push(`Spare reports the dropoff ${Math.round(alert.arrivalDelaySeconds / 60)} min late.`);
  }
  if (alert.startDelaySeconds !== null && (alert.detectionType === "spare_late_start" || alert.detectionType === "spare_multiple")) {
    lines.push(`Spare reports the pickup ${Math.round(alert.startDelaySeconds / 60)} min late.`);
  }
  return lines;
}

// ---------------------------------------------------------------------------

function flaggedDetail(alert: HeaderAlert, time: Time): string {
  const at = time(alert.firstSeenWatchingAt);
  if (alert.sourceSystem === "spare") {
    const ended = alert.spareTimes?.dropoff_arrived_at ?? null;
    const after = minutesBetween(ended, alert.firstSeenWatchingAt);
    return after !== null && after >= 0
      ? `${at} (${after} min after dropoff; on-demand rides are checked once they end)`
      : `${at} (on-demand rides are checked once they end)`;
  }
  const after = minutesBetween(alert.graceDeadlineAt, alert.firstSeenWatchingAt);
  return after !== null && after >= 0 ? `${at} (${after} min after the deadline)` : at;
}

export function caseHeader(alert: HeaderAlert, time: Time, options: { evidenceUnavailable?: boolean } = {}): CaseHeader {
  const details = [
    { label: "Source", value: sourceLabel(alert.sourceSystem) },
    { label: "Raised because", value: detectionTypeLabel(alert.detectionType) },
    { label: "Data", value: dataQualityLabel(alert.dataQualityStatus) },
    { label: "Detector version", value: alert.detectorVersion ?? "Not recorded" },
    { label: "Flagged", value: flaggedDetail(alert, time) },
    { label: alert.sourceSystem === "spare" ? "Ref" : "GTFS trip ID", value: alert.tripId },
  ];
  const counting = countingLine(alert);

  if (alert.sourceSystem === "spare") {
    const times = alert.spareTimes ?? null;
    const scheduled = [
      promised("Pickup", times?.original_pickup_at ?? null, times?.scheduled_pickup_at ?? alert.scheduledDepartureAt, time),
      promised("Dropoff", times?.original_dropoff_at ?? null, times?.scheduled_dropoff_at ?? null, time),
    ].filter((line): line is string => line !== null);
    return { scheduledLabel: "Booked", scheduled, seen: spareSeen(alert, times, time), looksLike: spareLooksLike(alert, times), counting, details };
  }

  const evidence = alert.gtfsEvidence;
  const origin = evidence?.origin_stop?.name ?? null;
  const block = evidence?.block?.block_id ?? null;
  const scheduled = [
    `Leave ${origin ?? "the first stop"} ${time(alert.scheduledDepartureAt)}${block ? ` · Block ${block}` : ""}`,
    `30-minute deadline ${time(alert.graceDeadlineAt)}`,
  ];
  return {
    scheduledLabel: "Scheduled",
    scheduled,
    seen: gtfsSeen(alert, time, options.evidenceUnavailable === true),
    looksLike: gtfsLooksLike(alert),
    counting,
    details,
  };
}
