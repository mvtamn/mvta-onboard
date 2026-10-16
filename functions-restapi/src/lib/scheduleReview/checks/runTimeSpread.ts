import type { CheckModule } from "./check";
import { capped, evidence, patternText, round, tripsWord } from "./check";

export const runTimeSpread: CheckModule = {
  definition: {
    id: "run_time_spread",
    label: "Run-time spread",
    unit: "min",
    threshold: 15,
    comparison: "at_least",
    why: "The widest difference in scheduled running time for the same stops on the same route. The schedule itself admits the trip varies this much, which is where prediction error comes from.",
    owner: "scheduling",
    fix: "Check the trips at the extremes: a spread this wide on one stop pattern usually means one of them is wrong.",
  },
  evaluate(route, model) {
    const spreads = route.patterns
      .filter((pattern) => pattern.trips.length >= 2)
      .map((pattern) => {
        const times = pattern.trips.map((t) => t.runMinutes);
        return { pattern, min: Math.min(...times), max: Math.max(...times) };
      })
      .sort((a, b) => (b.max - b.min) - (a.max - a.min));
    if (spreads.length === 0) return { value: null, evidence: [] };
    const rows = spreads.map(({ pattern, min, max }) => evidence(
      `${patternText(model, pattern)}: ${round(min)}–${round(max)} min over ${tripsWord(pattern.trips.length)}`,
      { value: round(max - min), count: pattern.trips.length, stop_ids: [pattern.firstStopId, pattern.lastStopId], trip_ids: pattern.trips.map((t) => t.id) },
    ));
    return { value: round(spreads[0].max - spreads[0].min), evidence: capped(rows, "stop patterns") };
  },
};
