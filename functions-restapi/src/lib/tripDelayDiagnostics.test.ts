import { test } from "node:test";
import assert from "node:assert";
import {
  determineTripDelayState,
  TRIP_DELAY_STALE_AFTER_MINUTES,
} from "./tripDelayDiagnostics";

const NOW = new Date("2026-07-27T15:00:00.000Z");

test("reports missing configuration before evaluating feed freshness", () => {
  assert.strictEqual(
    determineTripDelayState({
      tripUpdatesConfigured: false,
      activeTripCount: 4,
      thresholdRiskCount: 2,
      lastTripUpdateAt: NOW,
      staticStopCount: 10,
      directionReferenceCount: 10,
      now: NOW,
    }),
    "configuration_missing",
  );
});

test("reports no current trips when the configured feed produces no active rows", () => {
  assert.strictEqual(
    determineTripDelayState({
      tripUpdatesConfigured: true,
      activeTripCount: 0,
      thresholdRiskCount: 0,
      lastTripUpdateAt: null,
      staticStopCount: 10,
      directionReferenceCount: 10,
      now: NOW,
    }),
    "no_current_trips",
  );
});

test("reports a stale feed after the freshness window", () => {
  const stale = new Date(
    NOW.getTime() - (TRIP_DELAY_STALE_AFTER_MINUTES + 1) * 60_000,
  );
  assert.strictEqual(
    determineTripDelayState({
      tripUpdatesConfigured: true,
      activeTripCount: 4,
      thresholdRiskCount: 2,
      lastTripUpdateAt: stale,
      staticStopCount: 10,
      directionReferenceCount: 10,
      now: NOW,
    }),
    "stale",
  );
});

test("reports current data within the freshness window", () => {
  const recent = new Date(NOW.getTime() - 2 * 60_000);
  assert.strictEqual(
    determineTripDelayState({
      tripUpdatesConfigured: true,
      activeTripCount: 4,
      thresholdRiskCount: 2,
      lastTripUpdateAt: recent,
      staticStopCount: 10,
      directionReferenceCount: 10,
      now: NOW,
    }),
    "current",
  );
});
