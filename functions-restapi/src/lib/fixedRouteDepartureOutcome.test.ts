import { test } from "node:test";
import assert from "node:assert";
import { fixedRouteDepartureOutcome, type FixedRouteDepartureJudgement } from "./fixedRouteDepartureOutcome";

const VARIANCE = 600;
const SETTLED_BEFORE = "20260905";

function row(overrides: Partial<FixedRouteDepartureJudgement>): FixedRouteDepartureJudgement {
  return {
    service_date: "20260904",
    pullout_status: "Late Pullout",
    pullout_scheduled: new Date("2026-09-04T09:58:00Z"),
    pullout_actual: new Date("2026-09-04T10:16:00Z"),
    pullout_delta_seconds: 18 * 60,
    ...overrides,
  };
}

test("a settled run past the allowance is late, matching the candidate rule", () => {
  assert.strictEqual(fixedRouteDepartureOutcome(row({}), VARIANCE, SETTLED_BEFORE), "late");
  assert.strictEqual(fixedRouteDepartureOutcome(row({ pullout_status: "Expired Pullout", pullout_delta_seconds: 601 }), VARIANCE, SETTLED_BEFORE), "late");
});

test("inside the allowance is departed even when Avail's status is a red one", () => {
  // Expired Pullout says the window elapsed, not that the bus never left; most
  // such runs leave a few minutes late and are not candidates.
  assert.strictEqual(fixedRouteDepartureOutcome(row({ pullout_status: "Expired Pullout", pullout_delta_seconds: 3 * 60 }), VARIANCE, SETTLED_BEFORE), "departed");
  assert.strictEqual(fixedRouteDepartureOutcome(row({ pullout_status: "Late Pullout", pullout_delta_seconds: VARIANCE }), VARIANCE, SETTLED_BEFORE), "departed");
  assert.strictEqual(fixedRouteDepartureOutcome(row({ pullout_status: "On Time Pullout", pullout_delta_seconds: 0 }), VARIANCE, SETTLED_BEFORE), "departed");
});

test("a run that never departed is no_departure only when Avail settled it as an outcome", () => {
  for (const status of ["Missed Pullout", "Missed Login", "Expired Pullout", "Late Pullout"]) {
    assert.strictEqual(
      fixedRouteDepartureOutcome(row({ pullout_status: status, pullout_actual: null, pullout_delta_seconds: null }), VARIANCE, SETTLED_BEFORE),
      "no_departure",
      status,
    );
  }
  // A missing pullout RECORD (the vehicle is running) or a status Avail never
  // classified is a data question, not a breach.
  assert.strictEqual(fixedRouteDepartureOutcome(row({ pullout_status: "On Route No Pullout", pullout_actual: null, pullout_delta_seconds: null }), VARIANCE, SETTLED_BEFORE), "unresolved");
  assert.strictEqual(fixedRouteDepartureOutcome(row({ pullout_status: null, pullout_actual: null, pullout_delta_seconds: null }), VARIANCE, SETTLED_BEFORE), "unresolved");
});

test("a status outside the outcome set is never late, whatever the delta says", () => {
  // Faithful to the predicate: pull-in statuses and On Route No Pullout are
  // not departure evidence, so their deltas do not raise candidates.
  assert.strictEqual(fixedRouteDepartureOutcome(row({ pullout_status: "Late Pullin", pullout_delta_seconds: 40 * 60 }), VARIANCE, SETTLED_BEFORE), "departed");
});

test("the current service day is not settled, whatever the row says", () => {
  assert.strictEqual(fixedRouteDepartureOutcome(row({ service_date: "20260905" }), VARIANCE, SETTLED_BEFORE), "not_settled");
  assert.strictEqual(fixedRouteDepartureOutcome(row({ service_date: "20260905", pullout_status: "Missed Pullout", pullout_actual: null, pullout_delta_seconds: null }), VARIANCE, SETTLED_BEFORE), "not_settled");
});

test("no scheduled pullout is a source gap, not a breach", () => {
  assert.strictEqual(fixedRouteDepartureOutcome(row({ pullout_scheduled: null, pullout_actual: null, pullout_delta_seconds: null }), VARIANCE, SETTLED_BEFORE), "no_schedule");
});

test("Avail's midnight placeholder is a source gap, not a missed departure", () => {
  // The real shape of the false positive this rule was written for: 18 blocks
  // a day arrive as Missed Pullout with a 00:00:00 scheduled pullout and no
  // actual, and none of them has ever departed. Before the placeholder was
  // matched they read as no_departure and became contractor penalties.
  const placeholder = row({
    pullout_status: "Missed Pullout",
    pullout_scheduled: new Date("2026-09-04T00:00:00Z"),
    pullout_actual: null,
    pullout_delta_seconds: null,
  });
  assert.strictEqual(fixedRouteDepartureOutcome(placeholder, VARIANCE, SETTLED_BEFORE), "no_schedule");
  // Missed Login arrives the same way and must read the same.
  assert.strictEqual(
    fixedRouteDepartureOutcome({ ...placeholder, pullout_status: "Missed Login" }, VARIANCE, SETTLED_BEFORE),
    "no_schedule",
  );
});

test("the placeholder is recognised however the driver hands the time back", () => {
  for (const scheduled of ["2026-09-04T00:00:00Z", "2026-09-04T00:00:00", "2026-09-04 00:00:00"]) {
    assert.strictEqual(
      fixedRouteDepartureOutcome(
        row({ pullout_status: "Missed Pullout", pullout_scheduled: scheduled, pullout_actual: null, pullout_delta_seconds: null }),
        VARIANCE,
        SETTLED_BEFORE,
      ),
      "no_schedule",
      scheduled,
    );
  }
});

test("only exact midnight is the placeholder, so real early runs still count", () => {
  // The guard must not swallow the genuine start of service. A 00:01 or 04:41
  // pullout is a committed time like any other.
  for (const scheduled of ["2026-09-04T00:01:00Z", "2026-09-04T00:00:30Z", "2026-09-04T04:41:00Z"]) {
    assert.strictEqual(
      fixedRouteDepartureOutcome(
        row({ pullout_status: "Missed Pullout", pullout_scheduled: scheduled, pullout_actual: null, pullout_delta_seconds: null }),
        VARIANCE,
        SETTLED_BEFORE,
      ),
      "no_departure",
      scheduled,
    );
  }
});
