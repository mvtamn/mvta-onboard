import type { ObservedReading, ObservedRouteSummary, PredictionRiskCheckDefinition, PredictionRiskOwner, PredictionRiskRoute } from "@mvta/shared";

// The Schedule Review route list: which routes, in what order. The fixable
// count is the server's (lib/scheduleReview/ranking.ts); this only orders and
// filters what it was given, and words each route's worst reading.

export type RouteSort = "confirmed" | "fixable" | "route";
export type OwnerFilter = "all" | Exclude<PredictionRiskOwner, "structural">;

export const OWNER_FILTERS: { key: OwnerFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "scheduling", label: "MVTA scheduling" },
  { key: "avail", label: "Avail export" },
  { key: "operations", label: "Operations" },
];

export interface RankedRouteItem {
  routeId: string;
  short: string;
  name: string | null;
  fixable: number;
  structural: number;
  /** Segments Avail confirms; null when not known (no access, or not measured). */
  confirmed: number | null;
  /** Avail has no rows for the route in the window. */
  notMeasured: boolean;
  worst: string | null;
}

const DIRECTION_WORDS: Record<string, string> = { N: "northbound", S: "southbound", E: "eastbound", W: "westbound" };

/** "PM 46% late at 157th Street Station westbound, against 4% midday" */
export function worstReadingText(reading: ObservedReading | null): string | null {
  if (!reading) return null;
  const way = reading.direction ? ` ${DIRECTION_WORDS[reading.direction] ?? reading.direction}` : "";
  if (reading.kind === "off_peak_over_run") {
    return `Midday ${reading.off_peak_pct}% early at ${reading.to_stop_name}${way}, against ${reading.peak_pct}% in the peaks`;
  }
  const period = reading.period === "am" ? "AM" : "PM";
  return `${period} ${reading.peak_pct}% late at ${reading.to_stop_name}${way}, against ${reading.off_peak_pct}% midday`;
}

export function rankRoutes(
  routes: readonly PredictionRiskRoute[],
  checks: readonly PredictionRiskCheckDefinition[],
  observed: readonly ObservedRouteSummary[] | null,
  sort: RouteSort,
  owner: OwnerFilter,
): RankedRouteItem[] {
  const ownerOf = new Map(checks.map((c) => [c.id, c.owner]));
  const byRoute = new Map((observed ?? []).map((o) => [o.route_id, o]));
  const items = routes
    .map((route, order) => {
      const o = byRoute.get(route.route_id);
      const flagged = route.checks.filter((c) => c.flagged);
      return {
        order,
        ownsFlag: (key: OwnerFilter) => key === "all" || flagged.some((c) => ownerOf.get(c.id) === key),
        item: {
          routeId: route.route_id,
          short: route.route_short_name,
          name: route.route_long_name ?? null,
          fixable: route.fixable_flag_count ?? route.flag_count,
          structural: route.structural_flag_count ?? 0,
          confirmed: o && o.measured ? o.confirmed_segments : null,
          notMeasured: Boolean(o && !o.measured),
          worst: o ? worstReadingText(o.worst) : null,
        } satisfies RankedRouteItem,
      };
    })
    .filter((x) => x.ownsFlag(owner));
  // Without Avail's readings, ranking by them falls back to fixable flags.
  const effective: RouteSort = sort === "confirmed" && !observed ? "fixable" : sort;
  const byNumber = (a: { item: RankedRouteItem; order: number }, b: { item: RankedRouteItem; order: number }) =>
    a.item.short.localeCompare(b.item.short, undefined, { numeric: true }) || a.order - b.order;
  items.sort((a, b) => {
    if (effective === "route") return byNumber(a, b);
    if (effective === "confirmed") {
      const ca = a.item.confirmed ?? -1;
      const cb = b.item.confirmed ?? -1;
      if (cb !== ca) return cb - ca;
    }
    return b.item.fixable - a.item.fixable || a.order - b.order;
  });
  return items.map((x) => x.item);
}
