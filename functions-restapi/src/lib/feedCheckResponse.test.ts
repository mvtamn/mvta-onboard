import assert from "node:assert/strict";
import test from "node:test";
import { ledgerFeedChecks, summarizeFeedResponse } from "./feedCheckResponse";
import { resolveKpiTrust, type KpiFeedHealth } from "./kpiTrust";

test("uses Spare's total instead of treating its data envelope as empty", () => {
  assert.deepEqual(
    summarizeFeedResponse({ total: 7, limit: 1, skip: 0, data: [{ id: "request-1", status: "completed" }] }),
    { records: 7, keys: ["id", "status"] },
  );
});

const SPARE_PIPELINE = [
  { name: "Spare missed-trip Requests ingestion", feedName: "spare_requests" },
  { name: "Spare missed-trip Slots ingestion", feedName: "spare_slots" },
] as const;

function spareHealth(minutesAgo: number, now: Date, extra: Partial<KpiFeedHealth> = {}) {
  const at = new Date(now.getTime() - minutesAgo * 60_000);
  return (feed_name: KpiFeedHealth["feed_name"]): KpiFeedHealth => ({
    feed_name, last_success_at: at, last_entity_count: 12, source_timestamp_at: at, ...extra,
  });
}

test("a Spare pipeline row agrees with KPI trust at 40 minutes, inside the 45-minute contract", () => {
  // The rows used to apply their own 35-minute rule, so between 35 and 45
  // minutes they read Stale beneath trust cards that called the feeds Current.
  const now = new Date("2026-09-16T15:00:00Z");
  const at40 = spareHealth(40, now);
  const records = [at40("spare_requests"), at40("spare_slots")];

  const checks = ledgerFeedChecks(SPARE_PIPELINE, records, now);
  const trust = resolveKpiTrust(records, now);

  assert.deepEqual(checks.map((check) => check.freshness), ["current", "current"]);
  for (const check of checks) {
    const feedName = SPARE_PIPELINE.find((feed) => feed.name === check.name)!.feedName;
    const dependency = trust.spare_missed_trips.dependencies.find((item) => item.feed_name === feedName)!;
    assert.equal(check.freshness, dependency.state);
  }
});

test("a Spare pipeline row goes stale when the contract does, and carries the recorded reason", () => {
  const now = new Date("2026-09-16T15:00:00Z");
  const at50 = spareHealth(50, now, { last_failure_at: now, last_failure_reason: "Spare /v1/requests returned HTTP 503" });
  const [requests] = ledgerFeedChecks(SPARE_PIPELINE, [at50("spare_requests"), at50("spare_slots")], now);

  assert.equal(requests.freshness, "stale");
  assert.equal(requests.error, "Spare /v1/requests returned HTTP 503");
  assert.equal(requests.records, 12);
});

test("a feed that has never recorded a success is not current", () => {
  const checks = ledgerFeedChecks(SPARE_PIPELINE, [], new Date("2026-09-16T15:00:00Z"));
  assert.deepEqual(checks.map((check) => [check.freshness, check.records, check.last_success_at]), [
    ["stale", 0, undefined],
    ["stale", 0, undefined],
  ]);
});
