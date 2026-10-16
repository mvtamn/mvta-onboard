import { miles } from "../distance";
import type { CheckModule } from "./check";
import { capped, evidence, pairText, round, tripsWord } from "./check";

export const longestHop: CheckModule = {
  definition: {
    id: "longest_hop",
    label: "Longest distance between stops",
    unit: "mi",
    threshold: 10,
    comparison: "at_least",
    why: "Stop-free freeway miles, measured along the route where the feed's shape distances allow. With no stop to arrive at, a late bus only shows up as late at the far end, so predictions downstream lag behind.",
    owner: "structural",
    fix: "The stop-free miles are the route. The mitigation is a prediction engine that tracks progress along the shape rather than schedule adherence at stops.",
  },
  evaluate(route, model) {
    let longest: number | null = null;
    const pairs = new Map<string, { from: string; to: string; miles: number; trips: string[] }>();
    for (const trip of route.trips) {
      for (const hop of trip.hops) {
        if (hop.metres === null) continue;
        const mi = miles(hop.metres);
        longest = Math.max(longest ?? 0, mi);
        const key = `${hop.prev.stopId}\u0000${hop.next.stopId}`;
        const pair = pairs.get(key) ?? { from: hop.prev.stopId, to: hop.next.stopId, miles: 0, trips: [] };
        pair.miles = Math.max(pair.miles, mi);
        pair.trips.push(trip.id);
        pairs.set(key, pair);
      }
    }
    const rows = [...pairs.values()]
      .filter((pair) => pair.miles >= 1)
      .sort((a, b) => b.miles - a.miles)
      .map((pair) => evidence(`${pairText(model, pair.from, pair.to)}: ${round(pair.miles, 1)} mi, ${tripsWord(pair.trips.length)}`, {
        value: round(pair.miles, 1),
        count: pair.trips.length,
        stop_ids: [pair.from, pair.to],
        trip_ids: pair.trips,
      }));
    return { value: longest === null ? null : round(longest, 1), evidence: capped(rows, "stop pairs") };
  },
};
