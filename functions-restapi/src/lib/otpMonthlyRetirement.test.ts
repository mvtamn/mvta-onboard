import assert from "node:assert/strict";
import test from "node:test";
import {
  RETIREMENT_MIN_COVERAGE,
  describeRetiredKey,
  retirementDecision,
} from "./otpMonthlyRetirement";

// The gate, which is the whole safety story of ADR 0043: this is the code that
// decides whether a route/stop/day of week missing from a payload means Avail
// stopped publishing it, or means the response was short. Get it wrong in one
// direction and contractual figures are deleted; get it wrong in the other and
// a month sits on the re-pull list forever.

test("retirementDecision", async (t) => {
  await t.test("a month with nothing stored retires nothing", () => {
    const decision = retirementDecision({ stored: 0, returned: 0, absent: 0 });
    assert.equal(decision.retire, false);
    assert.match(decision.reason, /nothing to retire/);
  });

  await t.test("a payload that brought back every key retires nothing", () => {
    const decision = retirementDecision({ stored: 910, returned: 910, absent: 0 });
    assert.equal(decision.retire, false);
    assert.equal(decision.coverage, 1);
    assert.match(decision.reason, /every stored key came back/);
  });

  await t.test("the real case: a handful of keys absent from an otherwise whole month", () => {
    // 2026-05 on dev: 991 stored keys came back, 8 did not.
    const decision = retirementDecision({ stored: 999, returned: 991, absent: 8 });
    assert.equal(decision.retire, true);
    assert.ok(decision.coverage > 0.99);
    assert.match(decision.reason, /8 of 999 stored keys were not returned/);
  });

  await t.test("a short delivery retires nothing, and says what it would have", () => {
    // The failure this gate exists for: a truncated response looks exactly
    // like a month that lost 60% of its keys.
    const decision = retirementDecision({ stored: 910, returned: 364, absent: 546 });
    assert.equal(decision.retire, false);
    assert.match(decision.reason, /546 of 910 stored keys were absent/);
    assert.match(decision.reason, /40\.0% of the month/);
    assert.match(decision.reason, /nothing was retired/);
  });

  await t.test("the threshold itself retires, a hair under it does not", () => {
    const stored = 1000;
    const atThreshold = retirementDecision({
      stored,
      returned: stored * RETIREMENT_MIN_COVERAGE,
      absent: stored - stored * RETIREMENT_MIN_COVERAGE,
    });
    assert.equal(atThreshold.retire, true);
    const justUnder = retirementDecision({
      stored,
      returned: stored * RETIREMENT_MIN_COVERAGE - 1,
      absent: stored - (stored * RETIREMENT_MIN_COVERAGE - 1),
    });
    assert.equal(justUnder.retire, false);
  });

  await t.test("a month down to a single key is a short delivery, not a cleared month", () => {
    // Arithmetic alone would call this 100% of what came back. Coverage is
    // measured against what is STORED, which is what makes it a refusal.
    const decision = retirementDecision({ stored: 880, returned: 1, absent: 879 });
    assert.equal(decision.retire, false);
    assert.ok(decision.coverage < 0.01);
  });
});

test("describeRetiredKey names the figure that is leaving", async (t) => {
  await t.test("the 2026-09 case, in the words the log and the console use", () => {
    assert.equal(
      describeRetiredKey("202609", {
        route_id: 499,
        stop_id: 31967,
        day_of_week: "Thur",
        stop_name: "Shakopee Walmart",
        total: 17,
        ontime: 17,
        measured_under: null,
      }),
      "202609: route 499 at Shakopee Walmart (stop 31967) on Thur - 17 departures, 17 on time, " +
        "measured under no recorded standard - retired, Avail no longer returns it",
    );
  });

  await t.test("a key with no stop name or figures still reads as a sentence", () => {
    const line = describeRetiredKey("202605", {
      route_id: 477,
      stop_id: 31153,
      day_of_week: "Mon",
      stop_name: null,
      total: null,
      ontime: null,
      measured_under: "1/5/15/30/0/1/1",
    });
    assert.match(line, /route 477 at stop 31153 on Mon/);
    assert.match(line, /no departures recorded/);
    assert.match(line, /measured under 1\/5\/15\/30\/0\/1\/1/);
  });
});
