// What the prediction capture keeps from one run, as lines of a daily file
// (plans/prediction-accuracy-evaluation.md section 4).
//
// The benchmark needs, for each trip and stop, every ETA riders were shown in
// the 15 minutes before the bus arrived, and when it actually arrived. Neither
// is kept anywhere: TripUpdates are read every five minutes for the current
// delay and then overwritten. So every run writes down, as plain CSV:
//
//   R  the run: when it ran and the two feeds' header timestamps, so minutes
//      when a feed was stale can be left out of the score rather than read as
//      bad predictions.
//   P  a prediction: trip, stop and predicted arrival, for stops predicted
//      up to 30 minutes ahead of the feed's timestamp. The benchmark buckets
//      by actual arrival (0-15 minutes), so an ETA can be badly wrong and
//      still count; 30 minutes leaves room for that.
//   B  a stop time up to 10 minutes BEHIND the feed's timestamp. It is one of
//      two things the feed does not distinguish: a time Avail kept for a stop
//      the bus has passed (it keeps these on about a third of trips, and they
//      cross-check the derived arrivals), or an ETA the bus is running late
//      against, which riders are still shown. The scorer tells them apart
//      with the V lines; the capture does not guess.
//   V  a vehicle: its trip, the stop sequence it is at or heading to, its
//      status and its own timestamp. Arrivals are derived from these.
//
// Fields are CSV-escaped; ids in this feed carry no commas today, but a stop
// id is not ours to promise. Pure: feed messages in, lines out.
import type { GtfsRtTripUpdateFeedMessage } from "../gtfsTripUpdates";
import type { GtfsRtVehiclePositionFeedMessage } from "../gtfsVehiclePositions";
import { agencyServiceDate } from "../missedTripTime";

/** Stop times kept: from this far behind the feed's timestamp ... */
export const CAPTURE_PAST_SECONDS = 10 * 60;
/** ... to this far ahead of it. */
export const CAPTURE_AHEAD_SECONDS = 30 * 60;

/** The capture runs every 30 s; TripUpdates (420 KB) are read on the :00 run only, VehiclePositions on both. */
export function readsTripUpdates(runAt: Date): boolean {
  return runAt.getUTCSeconds() < 30;
}

function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function line(...values: (string | number | null | undefined)[]): string {
  return values.map(field).join(",");
}

export interface CaptureLines {
  lines: string[];
  predictions: number;
  behind: number;
  vehicles: number;
}

export function captureLines(
  runAt: Date,
  tripUpdates: GtfsRtTripUpdateFeedMessage | null,
  vehiclePositions: GtfsRtVehiclePositionFeedMessage | null,
): CaptureLines {
  const run = Math.floor(runAt.getTime() / 1000);
  const lines = [line("R", run, tripUpdates?.Header.Timestamp ?? null, vehiclePositions?.Header.Timestamp ?? null)];
  let predictions = 0;
  let behind = 0;
  let vehicles = 0;

  // A prediction is judged against when it was published, not when we fetched it.
  const sampledAt = tripUpdates?.Header.Timestamp ?? run;
  for (const entity of tripUpdates?.Entities ?? []) {
    const update = entity.TripUpdate;
    if (!update?.Trip?.TripId) continue;
    const trip = update.Trip;
    const vehicle = update.Vehicle?.Id ?? null;
    for (const stop of update.StopTimeUpdates ?? []) {
      const at = stop.Arrival?.Time ?? stop.Departure?.Time ?? null;
      if (!at) continue;
      if (at < sampledAt) {
        if (sampledAt - at > CAPTURE_PAST_SECONDS) continue;
        lines.push(line("B", sampledAt, trip.TripId, trip.RouteId, trip.StartDate, stop.StopSequence, stop.StopId, at, vehicle));
        behind++;
      } else if (at - sampledAt <= CAPTURE_AHEAD_SECONDS) {
        lines.push(line("P", sampledAt, trip.TripId, trip.RouteId, trip.StartDate, stop.StopSequence, stop.StopId, at, vehicle));
        predictions++;
      }
    }
  }
  for (const entity of vehiclePositions?.Entities ?? []) {
    const v = entity.Vehicle;
    if (!v) continue;
    lines.push(line("V", vehiclePositions!.Header.Timestamp, v.Timestamp ?? null, v.Vehicle?.Id ?? entity.Id, v.Trip?.TripId ?? null,
      v.Trip?.RouteId ?? null, v.Trip?.StartDate ?? null, v.CurrentStopSequence ?? null, v.StopId ?? null, v.CurrentStatus ?? null));
    vehicles++;
  }
  return { lines, predictions, behind, vehicles };
}

/**
 * The daily file a run appends to: one per Central calendar date. A trip
 * running past midnight spans two files; the scorer reads the next day's file
 * up to the end of service for that.
 */
export function captureBlobName(runAt: Date): string {
  return `${agencyServiceDate(runAt).serviceDate}/capture.csv.gz`;
}
