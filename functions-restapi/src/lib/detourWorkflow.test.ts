import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentPurgeAt,
  canTransition,
  dateWindowsOverlap,
} from "./detourWorkflow.js";
import { computeDetourReadiness } from "./detourReadiness.js";

test("readiness explains the next operational action", () => {
  assert.equal(computeDetourReadiness("avail", "awaiting_fulfillment"), "ready_for_avail_entry");
  assert.equal(computeDetourReadiness("avail", "fulfillment_failed"), "avail_conflict");
  assert.equal(computeDetourReadiness("fixed_route_manual", "fulfilled"), "ready_for_manual_operations");
  assert.equal(computeDetourReadiness("avail", "closed"), "closed");
});

test("Avail fulfillment moves through fulfillment states before closure", () => {
  assert.equal(canTransition("approved", "awaiting_fulfillment", "avail"), true);
  assert.equal(canTransition("approved", "fulfilled", "avail"), false);
  assert.equal(canTransition("awaiting_fulfillment", "fulfilled", "avail"), true);
  assert.equal(canTransition("awaiting_fulfillment", "fulfillment_failed", "avail"), true);
  assert.equal(canTransition("fulfillment_failed", "awaiting_fulfillment", "avail"), true);
  assert.equal(canTransition("fulfilled", "closed", "avail"), true);
});

test("manual fulfillment can complete without Avail states", () => {
  assert.equal(canTransition("approved", "fulfilled", "fixed_route_manual"), true);
  assert.equal(canTransition("approved", "fulfilled", "mobility_manual"), true);
  assert.equal(canTransition("approved", "awaiting_fulfillment", "mobility_manual"), false);
  assert.equal(canTransition("fulfilled", "closed", "fixed_route_manual"), true);
});

test("temporal status labels are not workflow states", () => {
  assert.equal(canTransition("approved", "active" as never, "fixed_route_manual"), false);
  assert.equal(canTransition("fulfilled", "expired" as never, "fixed_route_manual"), false);
});

test("date windows overlap inclusively and support open-ended ranges", () => {
  assert.equal(
    dateWindowsOverlap(
      { start_date: "2026-08-01", end_date: "2026-08-10" },
      { start_date: "2026-08-10", end_date: "2026-08-20" },
    ),
    true,
  );
  assert.equal(
    dateWindowsOverlap(
      { start_date: "2026-08-01", end_date: "2026-08-10" },
      { start_date: "2026-08-11", end_date: null },
    ),
    false,
  );
});

test("attachments are retained for one year after expiry", () => {
  assert.equal(attachmentPurgeAt("2026-08-10T00:00:00Z").toISOString(), "2027-08-10T00:00:00.000Z");
});
