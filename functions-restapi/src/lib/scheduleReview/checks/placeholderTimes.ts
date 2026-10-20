import type { CheckModule } from "./check";
import { capped, evidence, pairText, percent, tripsWord } from "./check";

// A placeholder hop is at most this long in time and at least this far apart
// on the ground; two stop_times at the same platform are not a placeholder.
export const PLACEHOLDER_MAX_SECONDS = 1;
export const PLACEHOLDER_MIN_METRES = 100;

export const placeholderTimes: CheckModule = {
  definition: {
    id: "placeholder_times",
    label: "Placeholder stop times",
    unit: "%",
    threshold: 10,
    comparison: "at_least",
    why: "Stops scheduled one second after the previous stop although they are a block or more away. The in-between times are rounded to the minute and nudged by a second to stay in order, so a prediction that leans on scheduled stop-to-stop times is thrown off.",
    owner: "avail",
    fix: "Ask Avail to export interpolated in-between times instead of one-second increments, or add timepoints so each interpolation spans fewer stops.",
  },
  evaluate(route, model) {
    let hops = 0;
    let placeholders = 0;
    const pairs = new Map<string, { from: string; to: string; trips: string[] }>();
    for (const trip of route.trips) {
      for (const hop of trip.hops) {
        hops++;
        if (hop.metres === null) continue;
        if (hop.next.arrival - hop.prev.departure <= PLACEHOLDER_MAX_SECONDS && hop.metres >= PLACEHOLDER_MIN_METRES) {
          placeholders++;
          const key = `${hop.prev.stopId}\u0000${hop.next.stopId}`;
          const pair = pairs.get(key) ?? { from: hop.prev.stopId, to: hop.next.stopId, trips: [] };
          pair.trips.push(trip.id);
          pairs.set(key, pair);
        }
      }
    }
    const rows = [...pairs.values()]
      .sort((a, b) => b.trips.length - a.trips.length || a.from.localeCompare(b.from))
      .map((pair) => evidence(`${pairText(model, pair.from, pair.to)}: ${tripsWord(pair.trips.length)}`, {
        count: pair.trips.length,
        stop_ids: [pair.from, pair.to],
        trip_ids: pair.trips,
      }));
    return { value: percent(placeholders, hops), evidence: capped(rows, "stop pairs") };
  },
};
