// The Dispatch Log module's one piece of state and the pure functions over it
// (plans/dispatch-log-spec.md §4.3). The three views - Grid, Watch, Timeline -
// are presentation over these same rows: filtering, sorting, the summary and
// the selection all live here so no view can disagree with another.
import type { TripStartLogTrip } from "@mvta/shared";

export type TripStartView = "grid" | "watch" | "timeline";

export const TRIP_START_VIEWS: { key: TripStartView; label: string }[] = [
  { key: "grid", label: "Grid" },
  { key: "watch", label: "Watch" },
  { key: "timeline", label: "Timeline" },
];

// The workbook rule: within 5 minutes the OCS marks that it left late; over 5
// minutes the cell stays blank and normal late-route procedures apply.
export const LEFT_LATE_LIMIT_SECONDS = 5 * 60;

// How a trip's start reads once the buckets the desk actually uses are applied
// to the API's start_status and delay. `missed` is kept apart from `late_over_5`
// because it comes from a different determination (the missed-trip detector,
// >30 min or never), and `no_actual` is kept apart from both because it is not
// a verdict at all - the trip has no realtime evidence yet.
export type StartBucket = "on_time" | "left_late" | "late_over_5" | "missed" | "no_actual" | "canceled";

export const START_BUCKETS: { key: StartBucket; label: string; tone: "success" | "warning" | "danger" | "muted" }[] = [
  { key: "on_time", label: "On time", tone: "success" },
  { key: "left_late", label: "Left late ≤5", tone: "warning" },
  { key: "late_over_5", label: "Late over 5", tone: "danger" },
  { key: "missed", label: "Missed", tone: "danger" },
  { key: "no_actual", label: "No actual", tone: "muted" },
  { key: "canceled", label: "Canceled", tone: "muted" },
];

export function startBucket(trip: Pick<TripStartLogTrip, "start_status" | "start_delay_seconds">): StartBucket {
  switch (trip.start_status) {
    case "on_time":
      return "on_time";
    case "late":
      return trip.start_delay_seconds !== null && trip.start_delay_seconds <= LEFT_LATE_LIMIT_SECONDS
        ? "left_late"
        : "late_over_5";
    case "missed":
      return "missed";
    case "canceled":
      return "canceled";
    default:
      return "no_actual";
  }
}

export function bucketLabel(bucket: StartBucket): string {
  return START_BUCKETS.find((b) => b.key === bucket)?.label ?? bucket;
}

export interface TripStartFilters {
  search: string;
  route: string;
  status: StartBucket | "all";
  rotationOnly: boolean;
}

export const EMPTY_FILTERS: TripStartFilters = { search: "", route: "all", status: "all", rotationOnly: false };

export function filtersActive(filters: TripStartFilters): boolean {
  return filters.search.trim() !== "" || filters.route !== "all" || filters.status !== "all" || filters.rotationOnly;
}

export function routeLabel(trip: Pick<TripStartLogTrip, "route_short_name" | "route_id">): string {
  return trip.route_short_name?.trim() || trip.route_id;
}

// Sorted like a person reads route signs: numeric before alphabetic, numbers
// by value (so 440 precedes 1000), then everything else alphabetically.
export function routeOptions(trips: readonly TripStartLogTrip[]): string[] {
  const labels = [...new Set(trips.map(routeLabel))];
  return labels.sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    const aNum = Number.isFinite(an);
    const bNum = Number.isFinite(bn);
    if (aNum && bNum) return an - bn;
    if (aNum) return -1;
    if (bNum) return 1;
    return a.localeCompare(b);
  });
}

function haystack(trip: TripStartLogTrip): string {
  return [
    routeLabel(trip),
    trip.route_id,
    trip.block_id ?? "",
    trip.origin_stop_name ?? "",
    trip.direction_label ?? "",
    trip.trip_id,
  ]
    .join(" ")
    .toLowerCase();
}

export function applyFilters(trips: readonly TripStartLogTrip[], filters: TripStartFilters): TripStartLogTrip[] {
  const needle = filters.search.trim().toLowerCase();
  return trips.filter((trip) => {
    if (filters.rotationOnly && !trip.in_rotation) return false;
    if (filters.route !== "all" && routeLabel(trip) !== filters.route) return false;
    if (filters.status !== "all" && startBucket(trip) !== filters.status) return false;
    if (needle && !haystack(trip).includes(needle)) return false;
    return true;
  });
}

export type SortKey = "verified" | "scheduled" | "actual" | "delta" | "status" | "block" | "route" | "origin" | "direction";
export type SortDir = "asc" | "desc";

function compareNullable(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last in either direction
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function sortValue(trip: TripStartLogTrip, key: SortKey): string | number | null {
  switch (key) {
    // Initialed rows first by initials, then rotation rows still owing them,
    // then everything not on the list.
    case "verified": return trip.verification ? `0 ${trip.verification.verified_initials}` : trip.in_rotation ? "1" : null;
    case "scheduled": return trip.scheduled_start_seconds;
    case "actual": return trip.actual_start_at;
    case "delta": return trip.start_delay_seconds;
    case "status": return START_BUCKETS.findIndex((b) => b.key === startBucket(trip));
    case "block": return trip.block_id;
    case "route": return routeLabel(trip);
    case "origin": return trip.origin_stop_name;
    case "direction": return trip.direction_label;
  }
}

export function sortTrips(trips: readonly TripStartLogTrip[], key: SortKey, dir: SortDir): TripStartLogTrip[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...trips].sort((a, b) => {
    const primary = compareNullable(sortValue(a, key), sortValue(b, key));
    if (primary !== 0) {
      // Keep nulls last regardless of direction; only real values flip.
      const aNull = sortValue(a, key) === null;
      const bNull = sortValue(b, key) === null;
      return aNull || bNull ? primary : primary * sign;
    }
    return a.scheduled_start_seconds - b.scheduled_start_seconds || a.trip_id.localeCompare(b.trip_id);
  });
}

export interface TripStartSummary {
  counts: Record<StartBucket, number>;
  /** (on time + left late) over every trip with a verdict; null when none has one. */
  start_otp: number | null;
  /** Rotation trips nobody has initialed yet. */
  awaiting_initials: number;
}

export function summarize(trips: readonly TripStartLogTrip[]): TripStartSummary {
  const counts: Record<StartBucket, number> = {
    on_time: 0, left_late: 0, late_over_5: 0, missed: 0, no_actual: 0, canceled: 0,
  };
  let awaiting = 0;
  for (const trip of trips) {
    counts[startBucket(trip)]++;
    if (trip.in_rotation && !trip.verification) awaiting++;
  }
  // Canceled trips never ran and unknown ones have not been measured; neither
  // is a data point for start OTP.
  const judged = counts.on_time + counts.left_late + counts.late_over_5 + counts.missed;
  return {
    counts,
    start_otp: judged === 0 ? null : (counts.on_time + counts.left_late) / judged,
    awaiting_initials: awaiting,
  };
}

// --- formatting ------------------------------------------------------------

/** GTFS seconds as the clock the schedule prints, past-midnight kept ("25:10"). */
export function gtfsClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timeLabel(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function deltaLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return "0 min";
  return minutes > 0 ? `+${minutes} min` : `${minutes} min`;
}

const DAY_SHORT: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};

export function dayLabel(day: string | null): string {
  return day ? DAY_SHORT[day] ?? day : "—";
}

export function serviceDateToInput(serviceDate: string): string {
  return /^\d{8}$/.test(serviceDate)
    ? `${serviceDate.slice(0, 4)}-${serviceDate.slice(4, 6)}-${serviceDate.slice(6, 8)}`
    : "";
}

export function inputToServiceDate(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

export function serviceDateLabel(serviceDate: string): string {
  const input = serviceDateToInput(serviceDate);
  if (!input) return serviceDate;
  const date = new Date(`${input}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? serviceDate
    : date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function observationLabel(observation: string): string {
  return ({
    observed_on_time: "Observed on time",
    observed_left_late: "Observed left late",
    not_observed: "Not observed",
  } as Record<string, string>)[observation] ?? observation;
}

// --- Watch and Timeline (spec §4.3) -----------------------------------------

export const UP_NEXT_HORIZON_MINUTES = 90;

/** Today's agency-local service date, the same calendar-day rule the API uses. */
export function agencyTodayServiceDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function startMs(trip: TripStartLogTrip): number {
  return new Date(trip.scheduled_start_at).getTime();
}

/**
 * Every trip due within the horizon, rotation or not: the rotation is too
 * sparse to drive a watch queue on its own (a day carries ~16 rotation trips
 * across 18 hours), so the queue lists all upcoming trips and flags the ones
 * that owe initials.
 */
export function upNext(trips: readonly TripStartLogTrip[], now: Date, horizonMinutes = UP_NEXT_HORIZON_MINUTES): TripStartLogTrip[] {
  const from = now.getTime();
  const to = from + horizonMinutes * 60_000;
  return trips
    .filter((trip) => {
      const at = startMs(trip);
      return at >= from && at <= to && trip.actual_start_at === null && trip.start_status !== "canceled";
    })
    .sort((a, b) => startMs(a) - startMs(b) || a.trip_id.localeCompare(b.trip_id));
}

export type DispositionReason = "missed" | "late_over_5" | "no_actual_past_due";

export interface DispositionItem {
  trip: TripStartLogTrip;
  reason: DispositionReason;
  /** Lower is more urgent. */
  severity: number;
  /** Minutes since the scheduled start, for the no-actual case. */
  minutesPastDue: number;
}

export const DISPOSITION_LABEL: Record<DispositionReason, string> = {
  missed: "Missed",
  late_over_5: "Late over 5",
  no_actual_past_due: "No actual yet",
};

/**
 * Trips that need a person to decide something: missed, late beyond the
 * five-minute rule, or past due with no realtime evidence at all. Ordered by
 * severity, then by how long they have been waiting. Left late within five
 * minutes is a verification, not a disposition, so it is not listed here.
 */
export function needsDisposition(trips: readonly TripStartLogTrip[], now: Date): DispositionItem[] {
  const items: DispositionItem[] = [];
  for (const trip of trips) {
    const bucket = startBucket(trip);
    const minutesPastDue = Math.floor((now.getTime() - startMs(trip)) / 60_000);
    if (bucket === "missed") items.push({ trip, reason: "missed", severity: 0, minutesPastDue });
    else if (bucket === "late_over_5") items.push({ trip, reason: "late_over_5", severity: 1, minutesPastDue });
    else if (bucket === "no_actual" && minutesPastDue * 60 > LEFT_LATE_LIMIT_SECONDS) {
      items.push({ trip, reason: "no_actual_past_due", severity: 2, minutesPastDue });
    }
  }
  return items.sort((a, b) => a.severity - b.severity || b.minutesPastDue - a.minutesPastDue || a.trip.trip_id.localeCompare(b.trip.trip_id));
}

export interface TimelineRange {
  /** Epoch ms of the left edge, on a whole hour. */
  start: number;
  /** Epoch ms of the right edge, on a whole hour. */
  end: number;
}

export interface TimelineLane {
  block: string;
  trips: TripStartLogTrip[];
}

const HOUR_MS = 3_600_000;

/** One lane per block from the given rows, blocks in natural order, trips by scheduled start. */
export function timelineLanes(trips: readonly TripStartLogTrip[]): TimelineLane[] {
  const byBlock = new Map<string, TripStartLogTrip[]>();
  for (const trip of trips) {
    const block = trip.block_id ?? "—";
    const lane = byBlock.get(block);
    if (lane) lane.push(trip);
    else byBlock.set(block, [trip]);
  }
  // Blocks in natural order; trips with no block gather in a last lane.
  return [...byBlock.entries()]
    .sort(([a], [b]) => (a === "—") === (b === "—") ? a.localeCompare(b, undefined, { numeric: true }) : a === "—" ? 1 : -1)
    .map(([block, laneTrips]) => ({
      block,
      trips: [...laneTrips].sort((a, b) => startMs(a) - startMs(b) || a.trip_id.localeCompare(b.trip_id)),
    }));
}

/** The whole-hour span that holds every scheduled and actual start, padded by half an hour each side. */
export function timelineRange(trips: readonly TripStartLogTrip[]): TimelineRange | null {
  if (trips.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const trip of trips) {
    const sched = startMs(trip);
    const actual = trip.actual_start_at ? new Date(trip.actual_start_at).getTime() : sched;
    min = Math.min(min, sched, actual);
    max = Math.max(max, sched, actual);
  }
  return {
    start: Math.floor((min - HOUR_MS / 2) / HOUR_MS) * HOUR_MS,
    end: Math.ceil((max + HOUR_MS / 2) / HOUR_MS) * HOUR_MS,
  };
}

export function timelineX(atMs: number, range: TimelineRange, pxPerHour: number): number {
  return ((atMs - range.start) / HOUR_MS) * pxPerHour;
}

export function hourMarks(range: TimelineRange): number[] {
  const marks: number[] = [];
  for (let t = range.start; t <= range.end; t += HOUR_MS) marks.push(t);
  return marks;
}

export function hourLabel(atMs: number): string {
  return new Date(atMs).toLocaleTimeString([], { hour: "numeric" });
}
