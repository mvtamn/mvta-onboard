import assert from "node:assert/strict";
import test from "node:test";
import { readTripUpdateFeed, type TripUpdateIngestDeps } from "./gtfsTripUpdateIngest";
import type { GtfsRtTripUpdateFeedMessage } from "./gtfsTripUpdates";

type HealthCall = { feedName: string; entityCount: number; sourceTimestamp: number | null };

function feedOf(entityCount: number, timestamp: number | null = 1_770_000_000): GtfsRtTripUpdateFeedMessage {
  return {
    Header: timestamp === null ? undefined : { Timestamp: timestamp },
    Entities: Array.from({ length: entityCount }, (_, i) => ({ Id: `e${i}` })),
  } as unknown as GtfsRtTripUpdateFeedMessage;
}

function harness(overrides: Partial<TripUpdateIngestDeps> = {}) {
  const health: HealthCall[] = [];
  const failures: string[] = [];
  const pool = { marker: "pool" };
  const deps: TripUpdateIngestDeps = {
    fetchFeed: async () => feedOf(3),
    connect: async () => pool as never,
    recordHealth: (async (_pool, feedName, entityCount, sourceTimestamp) => {
      health.push({ feedName, entityCount, sourceTimestamp: sourceTimestamp ?? null });
    }) as TripUpdateIngestDeps["recordHealth"],
    recordFailure: (async (_pool, feedName) => {
      failures.push(feedName);
    }) as TripUpdateIngestDeps["recordFailure"],
    ...overrides,
  };
  const errors: string[] = [];
  const context = { error: (...args: unknown[]) => errors.push(String(args[0])) };
  return { deps, context, health, failures, errors, pool };
}

test("records the delivery once, from the entity count and the feed header", () => {
  // gtfsDelaysPoll and gtfsMissedTripsPoll both read this feed on the same
  // schedule and both used to write this row themselves. One definition here
  // is what keeps them from describing the same delivery differently.
  const h = harness({ fetchFeed: async () => feedOf(42, 1_770_000_123) });
  return readTripUpdateFeed("https://feed.test", h.context, h.deps).then((ingest) => {
    assert.ok(ingest);
    assert.equal(ingest!.feed.Entities.length, 42);
    assert.deepEqual(h.health, [
      { feedName: "gtfs_trip_updates", entityCount: 42, sourceTimestamp: 1_770_000_123 },
    ]);
    assert.deepEqual(h.failures, []);
  });
});

test("a failed fetch records a failure, no health, and stops the caller", async () => {
  // Returning null is the whole contract for the caller: the failure is already
  // on the ledger, so the poller just returns rather than recording its own.
  const h = harness({
    fetchFeed: async () => {
      throw new Error("connection reset");
    },
  });

  const ingest = await readTripUpdateFeed("https://feed.test", h.context, h.deps);

  assert.equal(ingest, null);
  assert.deepEqual(h.failures, ["gtfs_trip_updates"]);
  assert.deepEqual(h.health, [], "a failed fetch must never advance last_success_at");
});

test("an empty delivery is still a delivery", async () => {
  // Per ADR 0027 a successful run with no records is Current-but-empty, and
  // entity_count 0 is what the trust contract reads to say so.
  const h = harness({ fetchFeed: async () => feedOf(0) });

  const ingest = await readTripUpdateFeed("https://feed.test", h.context, h.deps);

  assert.ok(ingest);
  assert.equal(h.health[0]?.entityCount, 0);
  assert.deepEqual(h.failures, []);
});

test("a feed with no header timestamp records none rather than inventing one", async () => {
  const h = harness({ fetchFeed: async () => feedOf(5, null) });

  await readTripUpdateFeed("https://feed.test", h.context, h.deps);

  assert.equal(h.health[0]?.sourceTimestamp, null);
});

test("a ledger write that fails does not cost the caller the feed", async () => {
  // Both pollers have work to do with this delivery whether or not its trust
  // row could be updated. Losing the feed here would turn a ledger problem into
  // a missed detection cycle.
  const h = harness({
    recordHealth: (async () => {
      throw new Error("ledger unavailable");
    }) as TripUpdateIngestDeps["recordHealth"],
  });

  const ingest = await readTripUpdateFeed("https://feed.test", h.context, h.deps);

  assert.ok(ingest, "the feed must still reach the poller");
  assert.equal(ingest!.feed.Entities.length, 3);
  assert.ok(h.errors.some((line) => line.includes("Failed to update TripUpdate feed health")));
});
