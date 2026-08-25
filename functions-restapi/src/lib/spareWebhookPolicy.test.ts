import assert from "node:assert/strict";
import test from "node:test";
import { hasSpareWebhookAuthorization, spareWebhookEventType } from "./spareWebhookPolicy";

test("accepts only the dedicated bearer secret", () => {
  assert.equal(hasSpareWebhookAuthorization("Bearer receiver-secret", "receiver-secret"), true);
  assert.equal(hasSpareWebhookAuthorization("Bearer wrong", "receiver-secret"), false);
  assert.equal(hasSpareWebhookAuthorization(null, "receiver-secret"), false);
});

test("allows only the four approved Spare event types", () => {
  assert.equal(spareWebhookEventType({ type: "requestStatus", data: {} }), "requestStatus");
  assert.equal(spareWebhookEventType({ type: "riderCreated", data: {} }), null);
  assert.equal(spareWebhookEventType(null), null);
});
