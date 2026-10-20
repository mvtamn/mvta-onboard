import { PEAK_HOURS } from "../feedModel";
import type { CheckModule } from "./check";
import { capped, evidence, patternText, percent, round, tripsWord } from "./check";

/** Running times within this many minutes of each other count as the same. */
export const FLAT_WITHIN_MINUTES = 1;

// Found on the 20260909 feed: nine of nineteen routes schedule one running
// time for every trip on a pattern from 5am to 7pm (420 is 40 minutes at every
// hour). The run_time_spread check reads that as good. For a local route
// crossing arterials it is the opposite: the schedule denies that traffic
// exists, so peak trips run late and midday trips run early, every day.
export const runTimeFlat: CheckModule = {
  definition: {
    id: "run_time_flat",
    label: "Same running time all day",
    unit: "%",
    threshold: 50,
    comparison: "at_least",
    why: "Trips on one stop pattern scheduled with the same running time in the peak and off-peak. The schedule says traffic never changes, so a prediction that starts from it is late in the peak and early midday, every day.",
    owner: "scheduling",
    fix: "Give the pattern peak and off-peak running times. Confirm against OTP by hour first: late in the peak and early midday is the signature.",
  },
  evaluate(route, model) {
    let eligibleTrips = 0;
    let flatTrips = 0;
    const rows: { trips: number; row: ReturnType<typeof evidence> }[] = [];
    for (const pattern of route.patterns) {
      const hours = new Set(pattern.trips.map((t) => t.startHour));
      const spansPeak = [...hours].some((h) => PEAK_HOURS.has(h));
      const spansOffPeak = [...hours].some((h) => !PEAK_HOURS.has(h));
      if (!spansPeak || !spansOffPeak || pattern.trips.length < 2) continue;
      eligibleTrips += pattern.trips.length;
      const times = pattern.trips.map((t) => t.runMinutes);
      const min = Math.min(...times);
      const max = Math.max(...times);
      if (max - min > FLAT_WITHIN_MINUTES) continue;
      flatTrips += pattern.trips.length;
      const first = Math.min(...hours);
      const last = Math.max(...hours);
      rows.push({
        trips: pattern.trips.length,
        row: evidence(
          `${patternText(model, pattern)}: ${tripsWord(pattern.trips.length)} from ${String(first).padStart(2, "0")}:00 to ${String(last).padStart(2, "0")}:59, every one ${round(min)} min`,
          { value: round(min), count: pattern.trips.length, stop_ids: [pattern.firstStopId, pattern.lastStopId], trip_ids: pattern.trips.map((t) => t.id) },
        ),
      });
    }
    rows.sort((a, b) => b.trips - a.trips);
    return { value: percent(flatTrips, eligibleTrips), evidence: capped(rows.map((r) => r.row), "stop patterns") };
  },
};
