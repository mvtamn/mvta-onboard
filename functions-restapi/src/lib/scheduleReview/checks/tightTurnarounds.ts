import { clock } from "../feedModel";
import type { CheckModule } from "./check";
import { capped, evidence, percent, round } from "./check";

export const TIGHT_TURNAROUND_SECONDS = 180;

export const tightTurnarounds: CheckModule = {
  definition: {
    id: "tight_turnarounds",
    label: "Tight turnarounds",
    unit: "%",
    threshold: 40,
    comparison: "at_least",
    why: "Trips scheduled to leave within three minutes of the previous trip on the same bus ending. Any lateness carries straight into the next trip, before it has a GPS reading of its own.",
    owner: "scheduling",
    fix: "Add recovery time at the terminal where the lateness lands, or start the next trip from a different block.",
  },
  evaluate(route, model) {
    const tight = route.linksInto.filter((link) => link.layoverSeconds <= TIGHT_TURNAROUND_SECONDS);
    const rows = [...tight]
      .sort((a, b) => a.layoverSeconds - b.layoverSeconds)
      .map((link) => {
        const ends = link.prev.stopTimes[link.prev.stopTimes.length - 1];
        const starts = link.next.stopTimes[0];
        const prevRoute = model.routes.find((r) => r.id === link.prev.routeId)?.name ?? link.prev.routeId;
        return evidence(
          `${clock(starts.departure)} from ${model.stopName(starts.stopId)}: bus arrives ${clock(ends.arrival)} off route ${prevRoute}, ${round(link.layoverSeconds / 60)} min to turn`,
          { value: round(link.layoverSeconds / 60), stop_ids: [starts.stopId], trip_ids: [link.prev.id, link.next.id] },
        );
      });
    return { value: percent(tight.length, route.linksInto.length), evidence: capped(rows, "tight turnarounds") };
  },
};
