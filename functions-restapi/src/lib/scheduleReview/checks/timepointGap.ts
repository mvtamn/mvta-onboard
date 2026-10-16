import type { CheckModule } from "./check";
import { capped, evidence, pairText, round, tripsWord } from "./check";

export const timepointGap: CheckModule = {
  definition: {
    id: "timepoint_gap",
    label: "Longest gap between timepoints",
    unit: "min",
    threshold: 30,
    comparison: "at_least",
    why: "The longest stretch with no scheduled time the bus is held to. Over a long gap, traffic decides the arrival and the schedule says nothing about it.",
    owner: "structural",
    fix: "Not a schedule error on an express run. The prediction over the gap has to come from GPS progress, not the schedule; a mid-run timepoint helps only where the bus can actually be held to it.",
  },
  evaluate(route, model) {
    let longest: number | null = null;
    const rows = route.segments
      .map((segment) => {
        const max = Math.max(...segment.occurrences.map((o) => o.minutes));
        longest = Math.max(longest ?? 0, max);
        return { segment, max };
      })
      .sort((a, b) => b.max - a.max)
      .map(({ segment, max }) => evidence(
        `${pairText(model, segment.fromStopId, segment.toStopId)}: up to ${round(max)} min, ${tripsWord(segment.occurrences.length)}`,
        { value: round(max), count: segment.occurrences.length, stop_ids: [segment.fromStopId, segment.toStopId], trip_ids: segment.occurrences.map((o) => o.trip.id) },
      ));
    return { value: longest === null ? null : round(longest), evidence: capped(rows, "timepoint segments") };
  },
};
