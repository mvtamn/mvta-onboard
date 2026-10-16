import type { CheckModule } from "./check";
import { capped, evidence, percent, tripsWord } from "./check";

export const interlined: CheckModule = {
  definition: {
    id: "interlined",
    label: "Continues from another route",
    unit: "%",
    threshold: 50,
    comparison: "at_least",
    why: "Trips whose bus comes off a different route. Until that bus pulls in, this trip's prediction is only the schedule.",
    owner: "operations",
    fix: "Keep the interline knowingly: lateness on the partner route arrives here. Break it where the partner is often late.",
  },
  evaluate(route, model) {
    const partners = new Map<string, string[]>();
    let count = 0;
    for (const link of route.linksInto) {
      if (link.prev.routeId === route.id) continue;
      count++;
      const trips = partners.get(link.prev.routeId) ?? [];
      trips.push(link.next.id);
      partners.set(link.prev.routeId, trips);
    }
    const rows = [...partners.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([routeId, trips]) => {
        const name = model.routes.find((r) => r.id === routeId)?.name ?? routeId;
        return evidence(`From route ${name}: ${tripsWord(trips.length)}`, { count: trips.length, trip_ids: trips });
      });
    return { value: percent(count, route.linksInto.length), evidence: capped(rows, "partner routes") };
  },
};
