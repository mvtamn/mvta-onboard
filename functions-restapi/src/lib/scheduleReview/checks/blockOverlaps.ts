import { clock } from "../feedModel";
import type { CheckModule } from "./check";
import { capped, evidence, round } from "./check";

export const blockOverlaps: CheckModule = {
  definition: {
    id: "block_overlaps",
    label: "Impossible blocks",
    unit: "trips",
    threshold: 1,
    comparison: "at_least",
    why: "Trips scheduled to start before the previous trip on the same bus ends. The prediction engine has to guess which trip the bus is on.",
    owner: "scheduling",
    fix: "Fix the block: a trip cannot start before the previous one on the same bus has ended.",
  },
  evaluate(route, model) {
    if (route.linksInto.length === 0) return { value: null, evidence: [] };
    const overlaps = route.linksInto.filter((link) => link.layoverSeconds < 0);
    const rows = [...overlaps]
      .sort((a, b) => a.layoverSeconds - b.layoverSeconds)
      .map((link) => {
        const ends = link.prev.stopTimes[link.prev.stopTimes.length - 1];
        const starts = link.next.stopTimes[0];
        return evidence(
          `Block ${link.next.blockId ?? "?"}: trip ${link.next.id} leaves ${model.stopName(starts.stopId)} at ${clock(starts.departure)}, ${round(-link.layoverSeconds / 60)} min before trip ${link.prev.id} ends at ${clock(ends.arrival)}`,
          { value: round(-link.layoverSeconds / 60), stop_ids: [starts.stopId, ends.stopId], trip_ids: [link.prev.id, link.next.id] },
        );
      });
    return { value: overlaps.length, evidence: capped(rows, "overlaps") };
  },
};
