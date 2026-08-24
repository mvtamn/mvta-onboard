import test from "node:test";
import assert from "node:assert/strict";
import { formatEventGeofenceMessage, formatTeamsWebhookPayload, isTransientNotificationFailure, notificationHasExpired, retryDelaySeconds, shouldAutomaticallyDeliver } from "./eventNotificationPolicy";

test("formats event messages with the route captured from AVL", () => {
  assert.equal(formatEventGeofenceMessage({ vehicle_id: 1234, route_id: 55, route_label: "Fair Shuttle", transition: "enter", geofence_name: "Gate A", geofence_purpose: "staging", destination_label: "Proceed to staging", crossed_at: "2026-08-22T21:34:00Z", send_mode: "auto" }), "Bus 1234 on Route 55 · Fair Shuttle entered Gate A; Proceed to staging.\n\nGeofence: Gate A (staging)\nConfiguration: enter transition · custom message · auto delivery\nCrossed: 08/22/2026, 04:34 PM CDT");
});

test("formats standard operational messages from geofence events", () => {
  const input = { vehicle_id: 1234, route_id: 55, transition: "enter" as const, geofence_name: "Gate A approach", geofence_purpose: "venue", destination_label: null, crossed_at: "2026-08-22T21:34:00Z", location_name: "Gate A" };
  assert.match(formatEventGeofenceMessage({ ...input, message_type: "departing" }), /^Bus 1234 on Route 55 is departing Gate A\./);
  assert.match(formatEventGeofenceMessage({ ...input, message_type: "passed" }), /^Bus 1234 on Route 55 has passed Gate A\./);
  assert.match(formatEventGeofenceMessage({ ...input, message_type: "arriving_soon" }), /^Bus 1234 on Route 55 is arriving at Gate A soon\./);
  assert.match(formatEventGeofenceMessage({ ...input, message_type: "departing", destination_label: "Proceed to staging" }), /^Bus 1234 on Route 55 is departing Gate A; Proceed to staging\./);
});

test("formats Teams Workflows-compatible adaptive card payloads", () => {
  assert.deepEqual(formatTeamsWebhookPayload("Bus 1234 entered Gate A."), {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.2",
        body: [{ type: "TextBlock", text: "Bus 1234 entered Gate A.", wrap: true }],
      },
    }],
  });
});

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

test("only automatic rule messages deliver when Event AVL Teams delivery is enabled", () => {
  assert.equal(shouldAutomaticallyDeliver(true, "rule-1", "auto"), true);
  assert.equal(shouldAutomaticallyDeliver(true, "rule-1", "manual"), false);
  assert.equal(shouldAutomaticallyDeliver(false, "rule-1", "auto"), false);
  assert.equal(shouldAutomaticallyDeliver(true, null, "auto"), false);
});
