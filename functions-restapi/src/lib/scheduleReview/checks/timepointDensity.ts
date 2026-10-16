import type { CheckModule } from "./check";
import { capped, evidence, pairText, tripsWord } from "./check";

// Local routes on the 20260909 feed hold 4-10 timepoints over 50-90 stops; 420
// has four for 69. Between timepoints the bus is held to nothing and the
// engine interpolates over placeholder times, so this and placeholder_times
// compound.
export const timepointDensity: CheckModule = {
  definition: {
    id: "timepoint_density",
    label: "Most stops between timepoints",
    unit: "stops",
    threshold: 12,
    comparison: "at_least",
    why: "The longest run of stops between two timepoints. Between timepoints nothing holds the bus to a time and the engine interpolates, so the more stops in the run, the longer a prediction goes without a schedule to lean on.",
    owner: "scheduling",
    fix: "Add a timepoint in the middle of the run, somewhere the bus can be held, so the interpolation spans fewer stops.",
  },
  evaluate(route, model) {
    let longest: number | null = null;
    const runs = new Map<string, { from: string; to: string; stops: number; trips: string[] }>();
    for (const trip of route.trips) {
      let lastExact: { stopId: string; index: number } | null = null;
      trip.stopTimes.forEach((stopTime, index) => {
        if (!stopTime.exact) return;
        if (lastExact) {
          const between = index - lastExact.index - 1;
          longest = Math.max(longest ?? 0, between);
          const key = `${lastExact.stopId}\u0000${stopTime.stopId}`;
          const run = runs.get(key) ?? { from: lastExact.stopId, to: stopTime.stopId, stops: between, trips: [] };
          run.stops = Math.max(run.stops, between);
          run.trips.push(trip.id);
          runs.set(key, run);
        }
        lastExact = { stopId: stopTime.stopId, index };
      });
    }
    const rows = [...runs.values()]
      .filter((run) => run.stops > 0)
      .sort((a, b) => b.stops - a.stops || b.trips.length - a.trips.length)
      .map((run) => evidence(`${pairText(model, run.from, run.to)}: ${run.stops} stops in between, ${tripsWord(run.trips.length)}`, {
        value: run.stops,
        count: run.trips.length,
        stop_ids: [run.from, run.to],
        trip_ids: run.trips,
      }));
    return { value: longest, evidence: capped(rows, "timepoint segments") };
  },
};
