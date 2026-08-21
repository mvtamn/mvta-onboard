import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEPARTURE_RISK_THRESHOLD_SECONDS,
  departureRiskSeconds,
  isDepartureAtRisk,
} from "./tripDelayRisk";

test("uses raw seconds at the fixed-route risk boundary", () => {
  assert.equal(
    isDepartureAtRisk({
      delay_seconds: 0,
      predicted_max_departure_delay_seconds: DEPARTURE_RISK_THRESHOLD_SECONDS,
    }),
    false,
  );
  assert.equal(
    isDepartureAtRisk({ delay_seconds: 0, predicted_max_departure_delay_seconds: 901 }),
    true,
  );
  assert.equal(
    isDepartureAtRisk({ delay_seconds: 0, predicted_max_departure_delay_seconds: 915 }),
    true,
  );
  assert.equal(
    isDepartureAtRisk({ delay_seconds: 0, predicted_max_departure_delay_seconds: 929 }),
    true,
  );
  assert.equal(
    isDepartureAtRisk({ delay_seconds: 0, predicted_max_departure_delay_seconds: 930 }),
    true,
  );
});

test("falls back to current delay only when prediction is missing", () => {
  assert.equal(
    departureRiskSeconds({ delay_seconds: 901, predicted_max_departure_delay_seconds: null }),
    901,
  );
  assert.equal(
    isDepartureAtRisk({ delay_seconds: 901, predicted_max_departure_delay_seconds: null }),
    true,
  );
  assert.equal(
    isDepartureAtRisk({ delay_seconds: 1000, predicted_max_departure_delay_seconds: 600 }),
    false,
  );
});
