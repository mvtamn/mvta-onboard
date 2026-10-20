import { miles } from "../distance";
import type { CheckModule } from "./check";
import { capped, evidence, pairText, round, tripsWord } from "./check";

export const SLOW_MPH = 8;
export const FAST_MPH = 55;

// Only measured when the feed's shape distances calibrate: straight-line
// distance would make every winding segment look slow.
export const impliedSpeed: CheckModule = {
  definition: {
    id: "implied_speed",
    label: "Implausible scheduled speed",
    unit: "segments",
    threshold: 1,
    comparison: "at_least",
    why: "Timepoint segments whose scheduled time implies a speed under 8 or over 55 mph along the route. Too fast and the bus is scheduled to run late; too slow and it runs early and holds.",
    owner: "scheduling",
    fix: "Re-time the segment. A scheduled speed a bus cannot keep runs late every trip; one far below traffic runs early and holds at the next timepoint.",
  },
  evaluate(route, model) {
    if (model.distance.factor_to_metres === null) return { value: null, evidence: [] };
    const odd = new Map<string, { from: string; to: string; miles: number; minutes: number; mph: number | null; trips: string[] }>();
    const flaggedSegments = new Set<string>();
    for (const segment of route.segments) {
      for (const occurrence of segment.occurrences) {
        if (occurrence.metres === null) continue;
        const mi = miles(occurrence.metres);
        const mph = occurrence.minutes > 0 ? mi / (occurrence.minutes / 60) : null;
        const implausible = mph === null || mph < SLOW_MPH || mph > FAST_MPH;
        if (!implausible) continue;
        const segmentKey = `${segment.fromStopId}\u0000${segment.toStopId}`;
        flaggedSegments.add(segmentKey);
        const key = `${segmentKey}\u0000${round(occurrence.minutes)}`;
        const row = odd.get(key) ?? { from: segment.fromStopId, to: segment.toStopId, miles: mi, minutes: occurrence.minutes, mph, trips: [] };
        row.trips.push(occurrence.trip.id);
        odd.set(key, row);
      }
    }
    const rows = [...odd.values()]
      .sort((a, b) => (a.mph ?? Infinity) - (b.mph ?? Infinity))
      .map((row) => evidence(
        `${pairText(model, row.from, row.to)}: ${round(row.miles, 1)} mi in ${round(row.minutes)} min` +
          (row.mph === null ? " (no time at all)" : ` = ${round(row.mph)} mph`) + `, ${tripsWord(row.trips.length)}`,
        { value: row.mph === null ? null : round(row.mph), count: row.trips.length, stop_ids: [row.from, row.to], trip_ids: row.trips },
      ));
    return { value: flaggedSegments.size, evidence: capped(rows, "segment timings") };
  },
};
