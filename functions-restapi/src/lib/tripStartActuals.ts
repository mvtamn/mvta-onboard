// How a trip's actual start is read from GTFS-RT TripUpdate for the Dispatch
// Log (plans/dispatch-log-spec.md §5, option 1).
//
// Measured against MVTA's feed on 2026-09-05 (two samples a minute apart,
// 68 trips, 16 of them under way): the producer keeps a stop in a trip's
// StopTimeUpdate list for about fifteen minutes after the bus has passed it,
// with a realised time - every lingering first-stop time was under 900 s old,
// none older - and then drops it. Lingering times were stable between samples
// in seven of eight cases and revised once (earlier, by ~6 min), so a value
// is kept current while it lingers rather than frozen on first sight. Stop
// sequences are not contiguous (0, 60, 180, 540, 4020...), so the first stop
// is matched by stop id, then by the schedule's stored first sequence, never
// by "sequence 1".
//
// The rule that follows: poll every minute; while the first stop's time is
// still ahead of the feed clock it is a prediction and is remembered as one;
// once it is behind the feed clock it is the actual, updated while it lingers;
// if the stop has dropped before a realised time was seen (a poll outage), the
// last prediction stands in for it; and a trip that never shows a first stop
// falls back to the vehicle-position evidence, which fires at stop two and is
// therefore biased late (spec §3 gap 2).
import type { TripStartActualSource, TripStartStatus } from "./tripStartTypes";
import {
  SCHEDULE_RELATIONSHIP_CANCELED,
  type GtfsRtStopTimeUpdate,
  type GtfsRtTripUpdate,
} from "./gtfsTripUpdates";

/** A stop time this far behind the feed's own clock has happened. */
export const REALISED_GRACE_SECONDS = 30;
/** Under a minute late still reads as on time; the desk judged at minute granularity. */
export const ON_TIME_TOLERANCE_SECONDS = 59;
/** How long the producer keeps a passed stop in the list (measured 2026-09-05). */
export const LINGER_WINDOW_SECONDS = 15 * 60;

export interface TripStartRow {
  service_date: string;
  trip_id: string;
  origin_stop_id: string | null;
  first_stop_sequence: number | null;
  scheduled_start_at: Date;
  actual_start_at: Date | null;
  actual_start_source: TripStartActualSource | null;
  predicted_start_at: Date | null;
  start_status: TripStartStatus | null;
  /** GtfsTripOperationalEvidence.first_underway_at, when any. */
  first_underway_at: Date | null;
  /** A MonitoredMissedTrips row exists and has not been called a false positive. */
  missed: boolean;
}

export interface StartCapture {
  actual_start_at: Date | null;
  actual_start_source: TripStartActualSource | null;
  start_delay_seconds: number | null;
  start_status: TripStartStatus;
  predicted_start_at: Date | null;
}

export type FirstStopReading =
  | { kind: "realised"; at: Date }
  | { kind: "predicted"; at: Date }
  | { kind: "absent" };

export function firstStopUpdate(update: GtfsRtTripUpdate, row: Pick<TripStartRow, "origin_stop_id" | "first_stop_sequence">): GtfsRtStopTimeUpdate | null {
  const updates = update.StopTimeUpdates ?? [];
  if (row.origin_stop_id) {
    const byStop = updates.find((u) => u.StopId === row.origin_stop_id);
    if (byStop) return byStop;
  }
  if (row.first_stop_sequence !== null) {
    const bySequence = updates.find((u) => u.StopSequence === row.first_stop_sequence);
    if (bySequence) return bySequence;
  }
  return null;
}

// Departure is the event; Arrival stands in only when the producer omits it,
// the same preference the delay mapper uses.
export function readFirstStop(update: GtfsRtTripUpdate, row: Pick<TripStartRow, "origin_stop_id" | "first_stop_sequence">, feedTimestampSeconds: number): FirstStopReading {
  const stop = firstStopUpdate(update, row);
  const time = stop?.Departure?.Time ?? stop?.Arrival?.Time;
  if (!stop || !time || !Number.isFinite(time)) return { kind: "absent" };
  const at = new Date(time * 1000);
  return time <= feedTimestampSeconds - REALISED_GRACE_SECONDS ? { kind: "realised", at } : { kind: "predicted", at };
}

export function startDelaySeconds(scheduledAt: Date, actualAt: Date): number {
  return Math.round((actualAt.getTime() - scheduledAt.getTime()) / 1000);
}

export function startStatusFor(delaySeconds: number): TripStartStatus {
  return delaySeconds <= ON_TIME_TOLERANCE_SECONDS ? "on_time" : "late";
}

function withActual(row: TripStartRow, at: Date, source: TripStartActualSource, predicted: Date | null): StartCapture {
  const delay = startDelaySeconds(row.scheduled_start_at, at);
  return {
    actual_start_at: at,
    actual_start_source: source,
    start_delay_seconds: delay,
    start_status: startStatusFor(delay),
    predicted_start_at: predicted,
  };
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/**
 * What this poll should write for one row, or null when nothing changes.
 * `update` is the trip's TripUpdate in this feed delivery, if it appeared.
 */
export function planCapture(row: TripStartRow, update: GtfsRtTripUpdate | null, feedTimestamp: Date): StartCapture | null {
  const feedSeconds = Math.floor(feedTimestamp.getTime() / 1000);
  const hasActual = row.actual_start_at !== null;

  if (update && update.Trip.schedule_relationship === SCHEDULE_RELATIONSHIP_CANCELED) {
    if (hasActual || row.start_status === "canceled") return null;
    return { actual_start_at: null, actual_start_source: null, start_delay_seconds: null, start_status: "canceled", predicted_start_at: row.predicted_start_at };
  }

  if (update) {
    const reading = readFirstStop(update, row, feedSeconds);
    if (reading.kind === "realised") {
      // Kept current while it lingers: the producer revises a realised time
      // occasionally, and the last value before the stop drops is the best one.
      if (sameInstant(row.actual_start_at, reading.at) && row.actual_start_source === "trip_update") return null;
      return withActual(row, reading.at, "trip_update", row.predicted_start_at);
    }
    if (reading.kind === "predicted") {
      if (hasActual || sameInstant(row.predicted_start_at, reading.at)) return null;
      return { actual_start_at: null, actual_start_source: null, start_delay_seconds: null, start_status: row.start_status ?? "unknown", predicted_start_at: reading.at };
    }
    // The trip is in the feed but its first stop is gone: the linger window
    // was missed. The last prediction is the closest thing to the event.
    if (!hasActual) {
      if (row.predicted_start_at) return withActual(row, row.predicted_start_at, "trip_update", row.predicted_start_at);
      if (row.first_underway_at) return withActual(row, row.first_underway_at, "vehicle_position", null);
    }
    return null;
  }

  if (hasActual) return null;
  const pastWindow = feedTimestamp.getTime() >= row.scheduled_start_at.getTime() + LINGER_WINDOW_SECONDS * 1000;
  if (pastWindow && row.first_underway_at) return withActual(row, row.first_underway_at, "vehicle_position", row.predicted_start_at);
  if (row.missed && row.start_status !== "missed") {
    return { actual_start_at: null, actual_start_source: null, start_delay_seconds: null, start_status: "missed", predicted_start_at: row.predicted_start_at };
  }
  return null;
}
