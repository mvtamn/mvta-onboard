import { test } from "node:test";
import assert from "node:assert";
import { withFlagCounts } from "./ranking";
import { PREDICTION_RISK_CHECKS } from "./checks";
import type { PredictionRiskRoute } from "./types";

const route = (flags: string[]): PredictionRiskRoute => ({
  route_id: "490", route_short_name: "490", trip_count: 56, flag_count: flags.length,
  checks: PREDICTION_RISK_CHECKS.map((c) => ({ id: c.id, value: 1, flagged: flags.includes(c.id) })),
});

test("the two checks that describe the route, not its schedule, do not count as fixable", () => {
  const [ranked] = withFlagCounts([route(["placeholder_times", "interlined", "run_time_spread", "implied_speed", "timepoint_gap", "longest_hop"])], PREDICTION_RISK_CHECKS);
  assert.deepStrictEqual([ranked.flag_count, ranked.fixable_flag_count, ranked.structural_flag_count], [6, 4, 2]);
});

test("the owners come from today's definitions, so moving a check's owner moves the count", () => {
  const defs = PREDICTION_RISK_CHECKS.map((c) => (c.id === "interlined" ? { ...c, owner: "structural" as const } : c));
  const [ranked] = withFlagCounts([route(["interlined", "placeholder_times"])], defs);
  assert.deepStrictEqual([ranked.fixable_flag_count, ranked.structural_flag_count], [1, 1]);
});

test("only the two checks owned as structural are structural today", () => {
  assert.deepStrictEqual(PREDICTION_RISK_CHECKS.filter((c) => c.owner === "structural").map((c) => c.id), ["timepoint_gap", "longest_hop"]);
});
