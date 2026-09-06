import { test } from "node:test";
import assert from "node:assert";
import { isJudged, onDemandDepartureOutcome, type OnDemandDepartureJudgement } from "./onDemandDepartureOutcome";

const VARIANCE = 600;

function row(overrides: Partial<OnDemandDepartureJudgement>): OnDemandDepartureJudgement {
  return {
    duty_status: "completed",
    departure_scheduled: new Date("2026-09-04T11:00:00Z"),
    departure_actual: new Date("2026-09-04T11:17:00Z"),
    departure_delta_seconds: 17 * 60,
    no_departure: false,
    ...overrides,
  };
}

test("late past the allowance, departed within it", () => {
  assert.strictEqual(onDemandDepartureOutcome(row({}), VARIANCE), "late");
  assert.strictEqual(onDemandDepartureOutcome(row({ departure_delta_seconds: VARIANCE }), VARIANCE), "departed");
  assert.strictEqual(onDemandDepartureOutcome(row({ departure_delta_seconds: -120 }), VARIANCE), "departed");
});

test("no departure is what the SQL decided, and an undue duty is pending", () => {
  assert.strictEqual(onDemandDepartureOutcome(row({ departure_actual: null, departure_delta_seconds: null, no_departure: true }), VARIANCE), "no_departure");
  assert.strictEqual(onDemandDepartureOutcome(row({ duty_status: "scheduled", departure_actual: null, departure_delta_seconds: null, no_departure: false }), VARIANCE), "pending");
});

test("a cancelled duty is never late or missing, and no schedule is a source gap", () => {
  assert.strictEqual(onDemandDepartureOutcome(row({ duty_status: "cancelled", departure_actual: null, departure_delta_seconds: null }), VARIANCE), "cancelled");
  assert.strictEqual(onDemandDepartureOutcome(row({ departure_scheduled: null, departure_actual: null, departure_delta_seconds: null }), VARIANCE), "no_schedule");
});

test("only decided departures are judged", () => {
  assert.deepStrictEqual(
    (["late", "no_departure", "departed", "pending", "cancelled", "no_schedule"] as const).filter(isJudged),
    ["late", "no_departure", "departed"],
  );
});
