import assert from "node:assert/strict";
import test from "node:test";
import { capTriggers, consecutiveMonthsBelow, escalationMultiplier } from "./assessment/escalation";
import { assessmentInputHash, canonicalJson } from "./assessment/hash";
import { addBusinessDays, assertHolidayCoverage } from "./assessment/businessDays";
import { computePenalty } from "./assessment/penalty";
import { matchTier } from "./assessment/tiers";
import type { StandardTier } from "./assessment/types";

const otpTiers: StandardTier[] = [
  { tierOrder: 1, tierLabel: "meets", boundLow: 0.85, boundHigh: null, penaltyBasis: "none", penaltyAmount: 0 },
  { tierOrder: 2, tierLabel: "warning", boundLow: 0.8, boundHigh: 0.85, penaltyBasis: "none", penaltyAmount: 0 },
  { tierOrder: 3, tierLabel: "tier1", boundLow: 0.75, boundHigh: 0.8, penaltyBasis: "flat", penaltyAmount: 1500 },
  { tierOrder: 4, tierLabel: "tier2", boundLow: null, boundHigh: 0.75, penaltyBasis: "flat", penaltyAmount: 3500 },
];

test("tier boundaries are half-open", () => {
  assert.equal(matchTier(otpTiers, 0.85, "higher_is_better")?.tierLabel, "meets");
  assert.equal(matchTier(otpTiers, 0.8, "higher_is_better")?.tierLabel, "warning");
  assert.equal(matchTier(otpTiers, 0.75, "higher_is_better")?.tierLabel, "tier1");
  assert.equal(matchTier(otpTiers, 0.7499, "higher_is_better")?.tierLabel, "tier2");
});

test("qualifier tier wins over the default occurrence tier", () => {
  const tiers: StandardTier[] = [
    { tierOrder: 1, tierLabel: "tier1", boundLow: null, boundHigh: null, penaltyBasis: "per_unit", penaltyAmount: 1000 },
    { tierOrder: 2, tierLabel: "tier2", boundLow: null, boundHigh: null, qualifierCode: "LAST_TRIP_OF_DAY", penaltyBasis: "per_unit", penaltyAmount: 2000 },
  ];
  assert.equal(matchTier(tiers, 1, "lower_is_better", "LAST_TRIP_OF_DAY")?.penaltyAmount, 2000);
  assert.equal(matchTier(tiers, 1, "lower_is_better")?.penaltyAmount, 1000);
});

test("penalty bases calculate quantity and duration", () => {
  const base = { tierOrder: 1, tierLabel: "tier1" as const, boundLow: null, boundHigh: null, penaltyAmount: 100 };
  assert.equal(computePenalty({ ...base, penaltyBasis: "flat" }, { quantity: 3 }), 100);
  assert.equal(computePenalty({ ...base, penaltyBasis: "per_unit" }, { quantity: 3 }), 300);
  assert.equal(computePenalty({ ...base, penaltyBasis: "per_unit_per_day" }, { quantity: 3, durationDays: 2 }), 600);
  assert.equal(computePenalty({ ...base, penaltyBasis: "per_week" }, { quantity: 2, durationDays: 8 }), 400);
});

test("escalation begins at exactly three consecutive months", () => {
  assert.equal(consecutiveMonthsBelow([true, true, true, false]), 3);
  assert.equal(escalationMultiplier(2), 1);
  assert.equal(escalationMultiplier(3), 1.5);
});

test("CAP triggers are explicit and deduplicated by caller", () => {
  assert.deepEqual(capTriggers({ variancePct: -10 }), []);
  assert.deepEqual(capTriggers({ variancePct: -10.1, tierTriggersCap: true }), ["deviation_over_10pct", "tier_rule"]);
});

test("assessment hashes are stable across object key ordering", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(assessmentInputHash({ a: 1, b: 2 }), assessmentInputHash({ b: 2, a: 1 }));
});

test("business-day deadlines skip weekends and observed holidays", () => {
  const result = addBusinessDays(new Date("2026-12-23T12:00:00Z"), 3, new Set(["2026-12-25"]));
  assert.equal(result.toISOString().slice(0, 10), "2026-12-29");
});

test("holiday coverage fails closed", () => {
  assert.throws(
    () => assertHolidayCoverage(new Date("2026-12-01"), new Date("2027-01-15"), new Date("2026-12-31")),
    /does not cover/,
  );
});
