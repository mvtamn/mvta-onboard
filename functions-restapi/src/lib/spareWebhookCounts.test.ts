import assert from "node:assert/strict";
import test from "node:test";
import { etaUpdatesToRead, WebhookEventCounter } from "./spareWebhookCounts";

// What Spare sends, by type and what the receiver did with it. The receiver
// answers about 5,000 deliveries an hour and logs nothing per delivery, so the
// only way to decide which subscriptions are worth keeping is a periodic count.
test("counts deliveries by type and outcome, and reports once a window", () => {
  let now = 1_000_000;
  const counter = new WebhookEventCounter(60_000, () => now);

  counter.record("vehicleLocation", "coalesced");
  counter.record("vehicleLocation", "stored");
  counter.record("requestStatus", "stored");
  counter.record("eta", "skipped_not_monitored");
  assert.equal(counter.due(), null, "nothing is reported before the window is up");

  now += 60_000;
  assert.deepEqual(counter.due(), {
    window_seconds: 60,
    total: 4,
    by_type: { vehicleLocation: { coalesced: 1, stored: 1 }, requestStatus: { stored: 1 }, eta: { skipped_not_monitored: 1 } },
  });
});

test("each window counts only its own deliveries", () => {
  let now = 0;
  const counter = new WebhookEventCounter(60_000, () => now);
  counter.record("eta", "read");
  now += 60_000;
  counter.due();
  now += 60_000;
  assert.equal(counter.due(), null, "an empty window says nothing rather than reporting zeroes");
  counter.record("eta", "read");
  now += 60_000;
  assert.deepEqual(counter.due()?.by_type, { eta: { read: 1 } });
});

// An ETA payload carries no service and no ordering timestamp, so the receiver
// re-reads the request from Spare before applying it. That read is the most
// expensive thing it does, and it is wasted on a request the monitor is not
// tracking: the hourly reconciliation (ADR 0023) is what brings a request into
// monitoring, and a requestStatus delivery brings it sooner.
test("an ETA is re-read from Spare only for a request the monitor is tracking", () => {
  const updates = [
    { requestId: "req-monitored", pickupAt: null, dropoffAt: null },
    { requestId: "req-unknown", pickupAt: null, dropoffAt: null },
  ];
  assert.deepEqual(
    etaUpdatesToRead(updates, new Set(["req-monitored"])),
    { read: [updates[0]], skipped: 1 },
  );
  assert.deepEqual(etaUpdatesToRead(updates, new Set()), { read: [], skipped: 2 });
  assert.deepEqual(etaUpdatesToRead([], new Set(["req-monitored"])), { read: [], skipped: 0 });
});
