import { test } from "node:test";
import assert from "node:assert";
import { aggregateDelivery, parseEmailReceipts, validationResponse } from "./emailReceipts";

test("subscription validation echoes the code and is ignored otherwise", () => {
  assert.deepStrictEqual(validationResponse([{ eventType: "Microsoft.EventGrid.SubscriptionValidationEvent", data: { validationCode: "abc" } }]), { validationResponse: "abc" });
  assert.equal(validationResponse([{ eventType: "Microsoft.Communication.EmailDeliveryReportReceived", data: {} }]), null);
});

test("delivery reports map to receipt statuses and skip malformed events", () => {
  const receipts = parseEmailReceipts([
    { eventType: "Microsoft.Communication.EmailDeliveryReportReceived", data: { messageId: "m1", recipient: "a@x", status: "Delivered", deliveryAttemptTimestamp: "2026-09-04T10:00:00Z" } },
    { eventType: "Microsoft.Communication.EmailDeliveryReportReceived", data: { messageId: "m2", recipient: "b@x", status: "FilteredSpam", deliveryStatusDetails: { statusMessage: "Marked as spam" } } },
    { eventType: "Microsoft.Communication.EmailDeliveryReportReceived", data: { messageId: "m3", recipient: "c@x", status: "SomethingNew" } },
    { eventType: "Microsoft.Communication.EmailDeliveryReportReceived", data: { recipient: "d@x", status: "Delivered" } },
    { eventType: "Other", data: { messageId: "m9", recipient: "z@x", status: "Delivered" } },
  ]);
  assert.deepStrictEqual(receipts.map((r) => [r.provider_message_id, r.status, r.details, r.reported_at]), [
    ["m1", "delivered", null, "2026-09-04T10:00:00Z"],
    ["m2", "filtered_spam", "Marked as spam", null],
    ["m3", "failed", null, null],
  ]);
});

test("aggregate delivery distinguishes accepted, confirmed, partial, and failed", () => {
  assert.deepStrictEqual(aggregateDelivery([]), { status: "sent", failed: 0 });
  assert.deepStrictEqual(aggregateDelivery(["accepted", "accepted"]), { status: "sent", failed: 0 });
  assert.deepStrictEqual(aggregateDelivery(["delivered", "accepted"]), { status: "sent", failed: 0 });
  assert.deepStrictEqual(aggregateDelivery(["delivered", "expanded"]), { status: "delivered", failed: 0 });
  assert.deepStrictEqual(aggregateDelivery(["delivered", "bounced"]), { status: "partially_sent", failed: 1 });
  assert.deepStrictEqual(aggregateDelivery(["bounced", "suppressed"]), { status: "failed", failed: 2 });
});
