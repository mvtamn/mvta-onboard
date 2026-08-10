import test from "node:test";
import assert from "node:assert/strict";
import { isTransientNotificationFailure, notificationHasExpired, retryDelaySeconds } from "./eventNotificationPolicy";

test("classifies retryable Teams failures", () => {
  assert.equal(isTransientNotificationFailure(429), true);
  assert.equal(isTransientNotificationFailure(502), true);
  assert.equal(isTransientNotificationFailure(400), false);
});

test("backs off retries and caps the delay", () => {
  assert.equal(retryDelaySeconds(1), 30);
  assert.equal(retryDelaySeconds(3), 120);
  assert.equal(retryDelaySeconds(99), 86400);
});

test("expires manual notifications after 24 hours", () => {
  const now = new Date("2026-08-10T12:00:00Z");
  assert.equal(notificationHasExpired("2026-08-09T12:00:00Z", now), true);
  assert.equal(notificationHasExpired("2026-08-10T11:59:59Z", now), false);
});
