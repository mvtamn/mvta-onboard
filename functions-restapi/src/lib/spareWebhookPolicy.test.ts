import assert from "node:assert/strict";
import test from "node:test";
import { hasSpareWebhookAuthorization, spareWebhookEventType, spareWebhookSchema } from "./spareWebhookPolicy";

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

test("contract diagnostics retain field names but never values", () => {
  assert.deepEqual(
    spareWebhookSchema({
      type: "requestStatus",
      data: { id: "request-42", pickupLocation: { latitude: 44.8 }, rider: { phone: "555-0100" } },
    }),
    {
      envelope_fields: ["data", "type"],
      data_fields: ["id", "pickupLocation", "rider"],
      data_array_item_fields: {},
    },
  );
  assert.equal(spareWebhookSchema({ type: "riderCreated", data: {} }), null);
});

test("contract diagnostics retain array-item field names but never values", () => {
  assert.deepEqual(
    spareWebhookSchema({
      type: "eta",
      data: { updates: [{ requestId: "request-42", pickup: { eta: 123 } }, { requestId: "request-99", dropoff: { eta: 456 } }] },
    }),
    {
      envelope_fields: ["data", "type"],
      data_fields: ["updates"],
      data_array_item_fields: { updates: ["dropoff", "pickup", "requestId"] },
    },
  );
});
