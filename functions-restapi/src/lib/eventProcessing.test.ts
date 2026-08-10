import test from "node:test";
import assert from "node:assert/strict";
import { detectionWindowSeconds, isStableTransition, nextTransitionConfirmations, shouldAcceptObservation } from "./eventProcessing";

test("accepts a first observation and rejects an older report", () => {
  assert.equal(shouldAcceptObservation(null, { report_timestamp: "2026-08-10T12:00:00Z" }), true);
  assert.equal(shouldAcceptObservation({ report_timestamp: "2026-08-10T12:01:00Z" }, { report_timestamp: "2026-08-10T12:00:00Z" }), false);
  assert.equal(shouldAcceptObservation({ report_timestamp: "2026-08-10T12:01:00Z" }, { report_timestamp: "2026-08-10T12:01:00Z" }), true);
});

test("keeps the detector window at least three minutes and expands with polling", () => {
  assert.equal(detectionWindowSeconds(15), 180);
  assert.equal(detectionWindowSeconds(30), 180);
  assert.equal(detectionWindowSeconds(300), 600);
});

test("requires two observations on the new side before emitting a transition", () => {
  assert.equal(isStableTransition(false, true, 0), false);
  assert.equal(isStableTransition(false, true, 1), true);
  assert.equal(isStableTransition(false, true, 2), true);
  assert.equal(nextTransitionConfirmations(false, true, 0), 1);
  assert.equal(nextTransitionConfirmations(false, false, 1), 0);
});
