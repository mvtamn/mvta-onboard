import assert from "node:assert/strict";
import test from "node:test";
import { ledgerFeedChecks, summarizeFeedResponse } from "./feedCheckResponse";
import { feedDependency, resolveKpiTrust, type KpiFeedHealth } from "./kpiTrust";

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

test("a feed no KPI depends on is judged by the freshness table: the prediction capture is current for 5 minutes", () => {
  const now = new Date("2026-10-16T17:00:00Z");
  const record = (minutesAgo: number, reason: string | null = null): KpiFeedHealth => ({
    feed_name: "prediction_capture",
    last_success_at: new Date(now.getTime() - minutesAgo * 60_000),
    last_entity_count: 412,
    source_timestamp_at: new Date(now.getTime() - minutesAgo * 60_000),
    last_failure_at: reason ? now : null,
    last_failure_reason: reason,
  });
  const feeds = [{ name: "Prediction capture", feedName: "prediction_capture" as const }];

  assert.deepEqual(ledgerFeedChecks(feeds, [record(4)], now)[0], {
    name: "Prediction capture", configured: true, records: 412, freshness: "current", last_success_at: "2026-10-16T16:56:00.000Z",
  });
  const stale = ledgerFeedChecks(feeds, [record(6, "Both feeds failed")], now)[0];
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.error, "Both feeds failed");
  assert.equal(ledgerFeedChecks(feeds, [], now)[0].freshness, "stale");
});

test("the prediction capture ages by its source time: writing every run of a frozen feed is stale", () => {
  // It used to be judged by last success alone, so a capture that kept writing
  // the same frozen GTFS-RT snapshot read Current. The KPI trust rule takes the
  // older of the source time and the last success, and now so does this row.
  const now = new Date("2026-10-16T17:00:00Z");
  const feeds = [{ name: "Prediction capture", feedName: "prediction_capture" as const }];
  const frozen: KpiFeedHealth = {
    feed_name: "prediction_capture",
    last_success_at: new Date(now.getTime() - 30_000),
    last_entity_count: 412,
    source_timestamp_at: new Date(now.getTime() - 20 * 60_000),
  };
  assert.equal(ledgerFeedChecks(feeds, [frozen], now)[0].freshness, "stale");
  assert.equal(feedDependency("prediction_capture", frozen, now).state, "stale");

  // Records written with no source time have unproven coverage: unavailable,
  // which the row shows as stale.
  const unknownVintage = { ...frozen, source_timestamp_at: null };
  assert.equal(feedDependency("prediction_capture", unknownVintage, now).state, "unavailable");
  assert.equal(ledgerFeedChecks(feeds, [unknownVintage], now)[0].freshness, "stale");
});

test("a ledger row gets the same verdict from KPI trust and from its feed check row", () => {
  // One rule judges every feed. For each ledger feed on the page, in each
  // shape a row can take, the check row must agree with every KPI trust
  // dependency on that feed - and a feed no KPI declares with feedDependency.
  const now = new Date("2026-10-16T17:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const feeds = [
    { name: "Spare missed-trip Requests ingestion", feedName: "spare_requests" },
    { name: "Spare missed-trip Slots ingestion", feedName: "spare_slots" },
    { name: "Prediction capture", feedName: "prediction_capture" },
  ] as const;
  const shapes: { label: string; row: Omit<KpiFeedHealth, "feed_name"> | null }[] = [
    { label: "fresh", row: { last_success_at: ago(1), last_entity_count: 9, source_timestamp_at: ago(1) } },
    { label: "old success", row: { last_success_at: ago(60), last_entity_count: 9, source_timestamp_at: ago(60) } },
    { label: "frozen source", row: { last_success_at: ago(1), last_entity_count: 9, source_timestamp_at: ago(60) } },
    { label: "no source time", row: { last_success_at: ago(1), last_entity_count: 9, source_timestamp_at: null } },
    { label: "empty success", row: { last_success_at: ago(1), last_entity_count: 0, source_timestamp_at: null } },
    { label: "never succeeded", row: { last_success_at: null, last_entity_count: null, source_timestamp_at: null } },
    { label: "no row", row: null },
  ];
  for (const { label, row } of shapes) {
    const records = row ? feeds.map(({ feedName }) => ({ feed_name: feedName, ...row })) : [];
    const checks = ledgerFeedChecks(feeds, records, now);
    const trustDependencies = Object.values(resolveKpiTrust(records, now)).flatMap((stream) => stream.dependencies);
    for (const [index, { feedName }] of feeds.entries()) {
      const declared = trustDependencies.filter((item) => item.feed_name === feedName);
      const verdicts = declared.length > 0
        ? declared.map((item) => item.state)
        : [feedDependency(feedName, records.find((record) => record.feed_name === feedName), now).state];
      for (const state of verdicts) {
        assert.equal(checks[index].freshness, state === "current" ? "current" : "stale", `${feedName}, ${label}`);
      }
    }
  }
});
