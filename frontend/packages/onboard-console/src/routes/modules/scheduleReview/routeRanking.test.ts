import { describe, expect, it } from "vitest";
import type { ObservedRouteSummary, PredictionRiskCheckDefinition, PredictionRiskRoute } from "@mvta/shared";
import { rankRoutes, worstReadingText } from "./routeRanking.js";

const CHECKS = [
  { id: "placeholder_times", owner: "avail" },
  { id: "run_time_flat", owner: "scheduling" },
  { id: "interlined", owner: "operations" },
  { id: "timepoint_gap", owner: "structural" },
] as PredictionRiskCheckDefinition[];

function route(id: string, flagged: string[], fixable: number, structural = 0): PredictionRiskRoute {
  return {
    route_id: id, route_short_name: id, route_long_name: `Route ${id}`, trip_count: 10,
    flag_count: flagged.length, fixable_flag_count: fixable, structural_flag_count: structural,
    checks: CHECKS.map((c) => ({ id: c.id, value: 1, flagged: flagged.includes(c.id) })),
  };
}

const ROUTES = [
  route("490", ["placeholder_times", "interlined", "timepoint_gap"], 2, 1),
  route("420", ["placeholder_times", "run_time_flat"], 2),
  route("442", ["run_time_flat"], 1),
  route("445", ["placeholder_times", "run_time_flat", "interlined"], 3),
];

const reading = { kind: "peak_under_run", period: "pm", direction: "W", from_stop_id: "A", to_stop_id: "B", from_stop_name: "Rosemount", to_stop_name: "157th Street Station", scheduled_minutes: 20, peak_pct: 46, off_peak_pct: 4, upstream_pct: 20, text: "" } as const;
const OBSERVED: ObservedRouteSummary[] = [
  { route_id: "420", measured: true, departures: 1772, readings: 2, confirmed_segments: 2, worst: { ...reading } },
  { route_id: "442", measured: true, departures: 1438, readings: 1, confirmed_segments: 1, worst: null },
  { route_id: "445", measured: true, departures: 3335, readings: 0, confirmed_segments: 0, worst: null },
  { route_id: "490", measured: false, departures: 0, readings: 0, confirmed_segments: 0, worst: null },
];

describe("rankRoutes", () => {
  it("ranks by segments Avail confirms, then fixable flags, with unmeasured routes last", () => {
    expect(rankRoutes(ROUTES, CHECKS, OBSERVED, "confirmed", "all").map((r) => [r.short, r.confirmed])).toEqual([
      ["420", 2], ["442", 1], ["445", 0], ["490", null],
    ]);
  });

  it("falls back to fixable flags when Avail's readings are not available", () => {
    expect(rankRoutes(ROUTES, CHECKS, null, "confirmed", "all").map((r) => r.short)).toEqual(["445", "490", "420", "442"]);
  });

  it("counts only fixable flags: a structural one is shown, not ranked", () => {
    const r490 = rankRoutes(ROUTES, CHECKS, OBSERVED, "fixable", "all").find((r) => r.short === "490");
    expect([r490?.fixable, r490?.structural, r490?.notMeasured]).toEqual([2, 1, true]);
  });

  it("filters to routes with a flag that owner can fix", () => {
    expect(rankRoutes(ROUTES, CHECKS, OBSERVED, "route", "operations").map((r) => r.short)).toEqual(["445", "490"]);
    expect(rankRoutes(ROUTES, CHECKS, OBSERVED, "route", "all").map((r) => r.short)).toEqual(["420", "442", "445", "490"]);
  });

  it("words the worst reading for the list", () => {
    expect(worstReadingText({ ...reading })).toBe("PM 46% late at 157th Street Station westbound, against 4% midday");
    expect(worstReadingText({ ...reading, kind: "off_peak_over_run", period: "midday", peak_pct: 3, off_peak_pct: 30 })).toBe("Midday 30% early at 157th Street Station westbound, against 3% in the peaks");
    expect(worstReadingText(null)).toBeNull();
  });
});
