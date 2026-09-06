import { test } from "node:test";
import assert from "node:assert";
import { isJudged, onDemandDepartureOutcome, type OnDemandDepartureJudgement } from "./onDemandDepartureOutcome";

const VARIANCE = 600;
const SETTLED_BEFORE = "20260905";

function row(overrides: Partial<OnDemandDepartureJudgement>): OnDemandDepartureJudgement {
  return {
    service_date: "20260904",
    duty_status: "completed",
    departure_scheduled: new Date("2026-09-04T11:00:00Z"),
    departure_actual: new Date("2026-09-04T11:17:00Z"),
    departure_delta_seconds: 17 * 60,
    ...overrides,
  };
}

test("late past the allowance, departed within it, matching the candidate rule", () => {
  assert.strictEqual(onDemandDepartureOutcome(row({}), VARIANCE, SETTLED_BEFORE), "late");
  assert.strictEqual(onDemandDepartureOutcome(row({ departure_delta_seconds: VARIANCE }), VARIANCE, SETTLED_BEFORE), "departed");
  assert.strictEqual(onDemandDepartureOutcome(row({ departure_delta_seconds: -120 }), VARIANCE, SETTLED_BEFORE), "departed");
});

test("a settled duty with no departure from either source is no_departure", () => {
  assert.strictEqual(onDemandDepartureOutcome(row({ departure_actual: null, departure_delta_seconds: null }), VARIANCE, SETTLED_BEFORE), "no_departure");
});

test("the current service day is not settled, whatever the row says", () => {
  assert.strictEqual(onDemandDepartureOutcome(row({ service_date: "20260905" }), VARIANCE, SETTLED_BEFORE), "not_settled");
  assert.strictEqual(onDemandDepartureOutcome(row({ service_date: "20260905", departure_actual: null, departure_delta_seconds: null }), VARIANCE, SETTLED_BEFORE), "not_settled");
});

test("a cancelled duty is never late or missing, and no schedule is a source gap", () => {
  assert.strictEqual(onDemandDepartureOutcome(row({ duty_status: "Cancelled", departure_actual: null, departure_delta_seconds: null }), VARIANCE, SETTLED_BEFORE), "cancelled");
  assert.strictEqual(onDemandDepartureOutcome(row({ departure_scheduled: null, departure_actual: null, departure_delta_seconds: null }), VARIANCE, SETTLED_BEFORE), "no_schedule");
});

test("only decided departures are judged", () => {
  assert.deepStrictEqual(
    (["late", "no_departure", "departed", "cancelled", "no_schedule", "not_settled"] as const).filter(isJudged),
    ["late", "no_departure", "departed"],
  );
});
