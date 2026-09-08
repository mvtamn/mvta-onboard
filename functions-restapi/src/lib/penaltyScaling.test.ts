import { test } from "node:test";
import assert from "node:assert";
import { bandAmount, computePenalty, isRangedBand } from "./assessment/penalty";
import { bandMatchValue, matchTier } from "./assessment/tiers";
import { describeCapWindowBreach, findCapWindowBreach } from "./assessment/capWindow";
import type { StandardTier } from "./assessment/types";

const band = (over: Partial<StandardTier> = {}): StandardTier => ({
  tierOrder: 1, tierLabel: "tier1", boundLow: null, boundHigh: null,
  penaltyBasis: "per_unit", penaltyAmount: 500, ...over,
});

// --- ranged amounts: the contract sets bounds, a person sets the figure ---

test("a fixed band resolves without anyone being asked", () => {
  assert.strictEqual(isRangedBand(band()), false);
  assert.strictEqual(bandAmount(band()), 500);
});

test("a ranged band is unresolved until a reviewer enters a figure", () => {
  // Damage reimbursement runs $2,500-$10,000: the contract states bounds, and
  // the number depends on the facts of the collision.
  const ranged = band({ penaltyAmountMin: 2500, penaltyAmountMax: 10000 });
  assert.ok(isRangedBand(ranged));
  assert.strictEqual(bandAmount(ranged), null);
  assert.strictEqual(bandAmount(ranged, 4200), 4200);
});

test("an unresolved ranged band scores nothing rather than zero dollars", () => {
  // The distinction matters on an issued report: null means "waiting on a
  // figure", and scoring it as $0 would state that nothing is owed where the
  // contract says between $2,500 and $10,000 is.
  const ranged = band({ penaltyAmountMin: 2500, penaltyAmountMax: 10000 });
  assert.strictEqual(computePenalty(ranged, { quantity: 1 }), 0);
  assert.strictEqual(bandAmount(ranged), null);
});

test("a figure outside the contract's bounds is refused, not clamped", () => {
  const ranged = band({ penaltyAmountMin: 2500, penaltyAmountMax: 10000 });
  assert.throws(() => bandAmount(ranged, 12000), /outside the band's 2500-10000 range/);
  assert.throws(() => bandAmount(ranged, 100), /outside the band's 2500-10000 range/);
});

test("a reviewer's figure multiplies like any other amount", () => {
  const ranged = band({ penaltyAmountMin: 1000, penaltyAmountMax: 5000, penaltyBasis: "per_unit" });
  assert.strictEqual(computePenalty(ranged, { quantity: 3, assessedAmount: 2000 }), 6000);
});

// --- count-scaled bands ---

test("a count-scaled band matches the occurrence's position in the month", () => {
  // "The thirteenth through fifteenth cost $250 each" is a band bounded 13-16.
  // Matched against one occurrence's quantity it compared 13 against 1 and
  // never fired.
  assert.strictEqual(bandMatchValue("running_count", 1, 13), 13);
  assert.strictEqual(bandMatchValue("per_occurrence", 1, 13), 1);
});

test("the count-scaled ladder charges only from the band's start", () => {
  const ladder: StandardTier[] = [
    band({ tierOrder: 1, tierLabel: "meets", boundLow: null, boundHigh: 13, penaltyBasis: "none", penaltyAmount: 0 }),
    band({ tierOrder: 2, tierLabel: "tier1", boundLow: 13, boundHigh: 16, penaltyAmount: 250 }),
    band({ tierOrder: 3, tierLabel: "tier2", boundLow: 16, boundHigh: null, penaltyAmount: 250, triggersCap: true }),
  ];
  // The twelfth occurrence of the month is still inside the tolerated band.
  assert.strictEqual(matchTier(ladder, bandMatchValue("running_count", 1, 12), "lower_is_better")?.tierLabel, "meets");
  assert.strictEqual(matchTier(ladder, bandMatchValue("running_count", 1, 13), "lower_is_better")?.tierLabel, "tier1");
  const sixteenth = matchTier(ladder, bandMatchValue("running_count", 1, 16), "lower_is_better");
  assert.strictEqual(sixteenth?.tierLabel, "tier2");
  assert.strictEqual(sixteenth?.triggersCap, true);
});

// --- rolling corrective-action windows ---

const day = (date: string, quantity = 1) => ({ serviceDate: date, quantity });

test("more than five in thirty days breaches; exactly five does not", () => {
  // "More than 5" tolerates five - the sixth is the breach.
  const rule = { windowDays: 30, threshold: 5 };
  const five = ["20260301", "20260305", "20260310", "20260315", "20260320"].map((d) => day(d));
  assert.strictEqual(findCapWindowBreach(five, rule), null);
  const breach = findCapWindowBreach([...five, day("20260325")], rule);
  assert.ok(breach);
  assert.strictEqual(breach?.count, 6);
  assert.strictEqual(breach?.endedOn, "20260325");
});

test("the window rolls across month boundaries, which is the whole point", () => {
  // Four collisions in late March and two in early April breach a 30-day rule
  // that neither month breaches on its own.
  const rule = { windowDays: 30, threshold: 5 };
  const spread = ["20260325", "20260327", "20260329", "20260331", "20260402", "20260404"].map((d) => day(d));
  const breach = findCapWindowBreach(spread, rule);
  assert.ok(breach, "a rule counted per calendar month would have missed this");
  assert.strictEqual(breach?.count, 6);
});

test("occurrences outside the window do not accumulate", () => {
  const rule = { windowDays: 30, threshold: 2 };
  const spaced = ["20260101", "20260301", "20260501"].map((d) => day(d));
  assert.strictEqual(findCapWindowBreach(spaced, rule), null);
});

test("an occurrence carrying a quantity counts as that many events", () => {
  const rule = { windowDays: 30, threshold: 3 };
  assert.ok(findCapWindowBreach([day("20260301", 4)], rule));
  assert.strictEqual(findCapWindowBreach([day("20260301", 3)], rule), null);
});

test("a rule with no window or no threshold is not a rule", () => {
  assert.strictEqual(findCapWindowBreach([day("20260301")], { windowDays: 0, threshold: 5 }), null);
  assert.strictEqual(findCapWindowBreach([day("20260301")], { windowDays: 30, threshold: 0 }), null);
});

test("the breach says what was counted, over what dates, against what rule", () => {
  const rule = { windowDays: 30, threshold: 5 };
  const breach = findCapWindowBreach(["20260301", "20260302", "20260303", "20260304", "20260305", "20260306"].map((d) => day(d)), rule)!;
  assert.match(describeCapWindowBreach(breach, rule), /6 occurrences between 20260205 and 20260306 exceed the 5 tolerated in any 30 days/);
});

// --- calendar quarters, which are not rolling windows ---

test("a calendar quarter counts within the quarter and resets at its boundary", () => {
  // "3+ repeat cases per quarter" tolerates two: the third breaches.
  const rule = { mode: "calendar_quarter" as const, threshold: 2 };
  const twoInQ1 = ["20260115", "20260220"].map((d) => day(d));
  assert.strictEqual(findCapWindowBreach(twoInQ1, rule), null);
  const breach = findCapWindowBreach([...twoInQ1, day("20260310")], rule);
  assert.ok(breach);
  assert.strictEqual(breach?.count, 3);
  assert.strictEqual(breach?.startedOn, "20260101");
  assert.strictEqual(breach?.endedOn, "20260331");
});

test("the two modes genuinely disagree, which is why the choice is recorded", () => {
  // Three cases in December and three in January: never a calendar-quarter
  // breach, always a rolling-90-day one. Treating either as an approximation
  // of the other would score a corrective action that is not owed, or miss one
  // that is.
  const across = ["20251205", "20251215", "20251228", "20260105", "20260115", "20260125"].map((d) => day(d));
  assert.strictEqual(findCapWindowBreach(across, { mode: "calendar_quarter", threshold: 3 }), null);
  assert.ok(findCapWindowBreach(across, { mode: "rolling_days", windowDays: 90, threshold: 3 }));
});

test("quarter bounds are the real ones, including the short first quarter", () => {
  const q1 = findCapWindowBreach(["20260101", "20260201", "20260301"].map((d) => day(d)), { mode: "calendar_quarter", threshold: 2 });
  assert.strictEqual(q1?.endedOn, "20260331");
  const q4 = findCapWindowBreach(["20261001", "20261101", "20261201"].map((d) => day(d)), { mode: "calendar_quarter", threshold: 2 });
  assert.strictEqual(q4?.startedOn, "20261001");
  assert.strictEqual(q4?.endedOn, "20261231");
});

test("a rolling rule with no length is still not a rule, and a quarter needs none", () => {
  assert.strictEqual(findCapWindowBreach([day("20260301")], { mode: "rolling_days", threshold: 1 }), null);
  assert.ok(findCapWindowBreach([day("20260301"), day("20260302")], { mode: "calendar_quarter", threshold: 1 }));
});

test("the breach names the period it was counted over", () => {
  const rule = { mode: "calendar_quarter" as const, threshold: 2 };
  const breach = findCapWindowBreach(["20260115", "20260220", "20260310"].map((d) => day(d)), rule)!;
  assert.match(describeCapWindowBreach(breach, rule), /exceed the 2 tolerated in that calendar quarter/);
});

test("an omitted mode still means rolling days, so nothing already configured changes", () => {
  const legacy = { windowDays: 30, threshold: 5 };
  const six = ["20260301", "20260302", "20260303", "20260304", "20260305", "20260306"].map((d) => day(d));
  assert.ok(findCapWindowBreach(six, legacy));
  assert.match(describeCapWindowBreach(findCapWindowBreach(six, legacy)!, legacy), /in any 30 days/);
});
