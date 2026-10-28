// When a bus actually reached a stop, from the vehicle positions the capture
// kept every 30 seconds (plans/prediction-accuracy-evaluation.md section 3,
// ADR 0041).
//
// Each position says which stop sequence the bus is at or heading to:
//
//   STOPPED_AT k     it has reached stop k (and every stop before it)
//   IN_TRANSIT_TO k  it has left the stop before k and not reached k
//   INCOMING_AT k    the same, just closer
//
// So a stop s is reached in a sample when s <= k and the bus is stopped at k,
// or s < k otherwise. Avail's sequences have gaps (3240, 3600, 3840), so
// "the stop before k" is never k - 1; the comparison never needs it.
//
// The arrival lies between the last sample in which the stop was not yet
// reached and the first in which it was. That is an interval, not a time:
// about 30 seconds wide, bounded by the vehicle's own timestamps rather than
// when we fetched. The scorer judges a prediction at both ends and calls it
// indeterminate when the two disagree, which is what the ADR commits to.
//
// Where there is no honest interval there is no actual, and the reason is
// kept: the bus was already past the stop when we first saw it, it never
// reached it while we watched, or the samples either side are too far apart
// (a feed gap) to say when.
//
// One exception: a bus first seen standing at a stop, as at the start of a
// trip, is timed by when it LEFT, the rule the benchmark applies to
// departures. Predictions at a trip's first stop are departure times.
//
// Pure: samples in, intervals out.
import type { VehicleStatus } from "./captureFile";

export interface VehicleSample {
  /** The vehicle's own timestamp, else the feed's (epoch seconds). */
  at: number;
  stopSequence: number;
  status: VehicleStatus;
}

/** Samples further apart than this give no actual: a feed gap, not a 30-second step. */
export const MAX_ACTUAL_WINDOW_SECONDS = 120;

export type ActualArrival =
  /** Reached after `from` (the last sample before) and by `to` (the first sample at or past it). */
  | { kind: "actual"; from: number; to: number; timedBy: "arrival" | "departure" }
  /** Already past the stop in the first sample of the trip. */
  | { kind: "unseen" }
  /** Not reached in any sample: the trip ended, or the bus stopped reporting. */
  | { kind: "not_reached" }
  /** The samples either side are further apart than MAX_ACTUAL_WINDOW_SECONDS. */
  | { kind: "gap"; seconds: number };

function reached(sample: VehicleSample, stopSequence: number): boolean {
  return sample.status === "stopped" ? stopSequence <= sample.stopSequence : stopSequence < sample.stopSequence;
}

/**
 * A trip's samples in time order, one per timestamp. The :00 and :30 runs
 * often fetch the same vehicle report twice; the copy adds nothing.
 */
export function tripTimeline(samples: readonly VehicleSample[]): VehicleSample[] {
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const out: VehicleSample[] = [];
  for (const sample of sorted) {
    const last = out[out.length - 1];
    if (last && last.at === sample.at) {
      out[out.length - 1] = sample;
      continue;
    }
    out.push(sample);
  }
  return out;
}

function interval(before: VehicleSample, after: VehicleSample, timedBy: "arrival" | "departure"): ActualArrival {
  const seconds = after.at - before.at;
  if (seconds > MAX_ACTUAL_WINDOW_SECONDS) return { kind: "gap", seconds };
  return { kind: "actual", from: before.at, to: after.at, timedBy };
}

/** When the bus reached stop `stopSequence`, from its trip's timeline (see tripTimeline). */
export function actualArrival(timeline: readonly VehicleSample[], stopSequence: number): ActualArrival {
  const first = timeline.findIndex((sample) => reached(sample, stopSequence));
  if (first === -1) return { kind: "not_reached" };
  if (first > 0) return interval(timeline[first - 1], timeline[first], "arrival");

  // Reached in the very first sample. Only a bus standing at this stop can be
  // timed, by when it leaves; one already beyond it was not watched arriving.
  const start = timeline[0];
  if (start.status !== "stopped" || start.stopSequence !== stopSequence) return { kind: "unseen" };
  const left = timeline.findIndex((sample) => sample.stopSequence > stopSequence);
  if (left === -1) return { kind: "not_reached" };
  return interval(timeline[left - 1], timeline[left], "departure");
}
