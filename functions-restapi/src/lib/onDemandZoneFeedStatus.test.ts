import assert from "node:assert/strict";
import test from "node:test";
import type { KpiFeedHealth } from "./kpiTrust";
import { zoneFeedStatus } from "./onDemandZoneFeedStatus";

const now = new Date("2026-09-17T15:00:00Z");

function health(overrides: Partial<KpiFeedHealth>): KpiFeedHealth {
  return { feed_name: "on_demand_zones", last_success_at: null, last_entity_count: null, source_timestamp_at: null, ...overrides };
}

test("a feed with no address is not configured and has no check due", () => {
  assert.deepEqual(zoneFeedStatus({ configured: false, health: undefined, now }), {
    configured: false,
    last_checked_at: null,
    last_check_succeeded: null,
    last_failure_reason: null,
    next_check_at: null,
  });
});

test("a configured feed that has never run says so, and is due at the next 09:30 UTC", () => {
  // 15:00 UTC is past today's 09:30 check, so the next one is tomorrow.
  assert.deepEqual(zoneFeedStatus({ configured: true, health: undefined, now }), {
    configured: true,
    last_checked_at: null,
    last_check_succeeded: null,
    last_failure_reason: null,
    next_check_at: "2026-09-18T09:30:00.000Z",
  });
  assert.equal(zoneFeedStatus({ configured: true, health: undefined, now: new Date("2026-09-17T09:29:59Z") }).next_check_at,
    "2026-09-17T09:30:00.000Z");
});

test("the last check is whichever of the last success and the last failure is newer", () => {
  const succeeded = zoneFeedStatus({
    configured: true,
    health: health({ last_success_at: new Date("2026-09-17T09:30:07Z"), last_failure_at: new Date("2026-09-15T09:30:05Z"), last_failure_reason: "Spare returned 503" }),
    now,
  });
  assert.equal(succeeded.last_checked_at, "2026-09-17T09:30:07.000Z");
  assert.equal(succeeded.last_check_succeeded, true);
  assert.equal(succeeded.last_failure_reason, null, "an older failure is history, not the state of the feed");

  const failed = zoneFeedStatus({
    configured: true,
    health: health({ last_success_at: new Date("2026-09-16T09:30:07Z"), last_failure_at: new Date("2026-09-17T09:30:05Z"), last_failure_reason: "GTFS-Flex feed is missing expected Operational zones" }),
    now,
  });
  assert.equal(failed.last_checked_at, "2026-09-17T09:30:05.000Z");
  assert.equal(failed.last_check_succeeded, false);
  assert.equal(failed.last_failure_reason, "GTFS-Flex feed is missing expected Operational zones");
});
