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
    // The same hand-over on every service day (weekday, Saturday) is one row with a count, not one row per day.
    const grouped = new Map<string, { text: string; minutes: number; stopId: string; tripIds: string[] }>();
    for (const link of tight) {
      const ends = link.prev.stopTimes[link.prev.stopTimes.length - 1];
      const starts = link.next.stopTimes[0];
      const prevRoute = model.routes.find((r) => r.id === link.prev.routeId)?.name ?? link.prev.routeId;
      const minutes = round(link.layoverSeconds / 60);
      const text = `${clock(starts.departure)} from ${model.stopName(starts.stopId)}: bus arrives ${clock(ends.arrival)} off route ${prevRoute}, ${minutes} min to turn`;
      const row = grouped.get(text) ?? { text, minutes, stopId: starts.stopId, tripIds: [] };
      row.tripIds.push(link.prev.id, link.next.id);
      grouped.set(text, row);
    }
    const rows = [...grouped.values()]
      .sort((a, b) => a.minutes - b.minutes || a.text.localeCompare(b.text))
      .map((row) => {
        const days = row.tripIds.length / 2;
        return evidence(days > 1 ? `${row.text} (${days} service days)` : row.text, {
          value: row.minutes,
          count: days,
          stop_ids: [row.stopId],
          trip_ids: row.tripIds,
        });
      });
    return { value: percent(tight.length, route.linksInto.length), evidence: capped(rows, "tight turnarounds") };
  },
};
