import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentPurgeAt,
  canTransition,
  dateWindowsOverlap,
} from "./detourWorkflow.js";

test("Avail fulfillment requires build confirmation before activation", () => {
  assert.equal(canTransition("approved", "active", "avail"), false);
  assert.equal(canTransition("built_in_avail", "active", "avail"), true);
  assert.equal(canTransition("build_failed", "pending_avail_build", "avail"), true);
});

test("manual fulfillment can activate without Avail states", () => {
  assert.equal(canTransition("approved", "active", "fixed_route_manual"), true);
  assert.equal(canTransition("approved", "pending_avail_build", "mobility_manual"), false);
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
