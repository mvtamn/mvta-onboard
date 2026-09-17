import assert from "node:assert/strict";
import test from "node:test";
import type { FeedLedger } from "./feedRun";
import { fetchGtfsRtFeed, probeGtfsRtFeed, readTripUpdateDelivery, type GtfsRtTransport, type TripUpdateDeliveryDeps } from "./gtfsRtReader";
import type { GtfsRtTripUpdateFeedMessage } from "./gtfsTripUpdates";

function feedOf(entityCount: number, timestamp: number | null = 1_770_000_000): GtfsRtTripUpdateFeedMessage {
  return {
    Header: timestamp === null ? undefined : { Timestamp: timestamp },
    Entities: Array.from({ length: entityCount }, (_, i) => ({ Id: `e${i}` })),
  } as unknown as GtfsRtTripUpdateFeedMessage;
}

// A recorded InfoPoint response, served through an injected transport.
function served(body: string, status = 200) {
  const calls: { url: string; signal?: AbortSignal }[] = [];
  const transport: GtfsRtTransport = {
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, signal: init?.signal ?? undefined });
      return { ok: status >= 200 && status < 300, status, text: async () => body };
    }) as unknown as typeof fetch,
  };
  return { transport, calls };
}

function harness(overrides: Partial<TripUpdateDeliveryDeps> = {}) {
  const health: { feedName: string; entityCount: number; sourceTimestamp: number | null }[] = [];
  const failures: string[] = [];
  const ledger: FeedLedger = {
    recordHealth: async (feedName, entityCount, sourceTimestamp) => { health.push({ feedName, entityCount, sourceTimestamp }); },
    recordFailure: async (feedName) => { failures.push(feedName); },
  };
  const errors: string[] = [];
  const log = { log: () => {}, warn: () => {}, error: (...args: unknown[]) => errors.push(String(args[0])) };
  const deps: TripUpdateDeliveryDeps = {
    fetchFeed: async () => feedOf(3),
    ledger,
    ...overrides,
  };
  return { deps, log, health, failures, errors };
}

// --- fetching ---

test("every fetch carries a timeout", async () => {
  // None did: a hung InfoPoint response held the worker for as long as it liked.
  const s = served(JSON.stringify({ Header: { Timestamp: 1 }, Entities: [] }));
  await fetchGtfsRtFeed("vehicle_positions", "https://feed.test/vehicles?debug=true", s.transport);
  assert.equal(s.calls[0].url, "https://feed.test/vehicles?debug=true");
  assert.ok(s.calls[0].signal);
});

test("a body that is not a feed fails at the reader, naming the feed, not deep inside a poller", async () => {
  await assert.rejects(fetchGtfsRtFeed("alerts", "https://feed.test", served("<html>maintenance</html>").transport),
    /GTFS-RT Alert feed returned a body that is not JSON \(starts "<html>maintenance<\/html>"\)/);
  await assert.rejects(fetchGtfsRtFeed("trip_updates", "https://feed.test", served(JSON.stringify({ error: "x" })).transport),
    /GTFS-RT TripUpdate feed returned JSON without an Entities array/);
  await assert.rejects(fetchGtfsRtFeed("trip_updates", "https://feed.test", served("", 503).transport),
    /GTFS-RT TripUpdate feed request failed: 503/);
});

// --- the TripUpdate delivery, shared by all three consumers ---

test("records the delivery from the entity count and the feed header", async () => {
  const h = harness({ fetchFeed: async () => feedOf(42, 1_770_000_123) });
  const delivery = await readTripUpdateDelivery("https://feed.test", h.log, h.deps);
  assert.equal(delivery?.feed.Entities.length, 42);
  assert.deepEqual(h.health, [{ feedName: "gtfs_trip_updates", entityCount: 42, sourceTimestamp: 1_770_000_123 }]);
  assert.deepEqual(h.failures, []);
});

test("a failed fetch records a failure, no health, and stops the consumer", async () => {
  const h = harness({ fetchFeed: async () => { throw new Error("connection reset"); } });
  assert.equal(await readTripUpdateDelivery("https://feed.test", h.log, h.deps), null);
  assert.deepEqual(h.failures, ["gtfs_trip_updates"]);
  assert.deepEqual(h.health, [], "a failed fetch must never advance last_success_at");
});

test("an empty delivery is still a delivery", async () => {
  const h = harness({ fetchFeed: async () => feedOf(0) });
  assert.ok(await readTripUpdateDelivery("https://feed.test", h.log, h.deps));
  assert.equal(h.health[0]?.entityCount, 0);
});

test("a feed with no header timestamp records none rather than inventing one", async () => {
  const h = harness({ fetchFeed: async () => feedOf(5, null) });
  await readTripUpdateDelivery("https://feed.test", h.log, h.deps);
  assert.equal(h.health[0]?.sourceTimestamp, null);
});

test("a ledger write that fails does not cost the consumer the feed", async () => {
  const h = harness();
  h.deps.ledger = { recordHealth: async () => { throw new Error("ledger unavailable"); }, recordFailure: async () => {} };
  const delivery = await readTripUpdateDelivery("https://feed.test", h.log, h.deps);
  assert.equal(delivery?.feed.Entities.length, 3);
  assert.ok(h.errors.some((line) => line.includes("Failed to record gtfs_trip_updates feed health")));
});

// --- the /feed-checks probe ---

test("the feed check reads the poll's own setting through the same fetch", async () => {
  assert.deepEqual(await probeGtfsRtFeed("alerts", {}, {}), { name: "GTFS Alerts", configured: false });
  const ok = served(JSON.stringify({ Header: { Timestamp: 1 }, Entities: [{ Id: "a" }, { Id: "b" }] }));
  assert.deepEqual(
    await probeGtfsRtFeed("trip_updates", ok.transport, { GTFS_RT_TRIPUPDATE_URL: " https://feed.test/trips " }),
    { name: "GTFS TripUpdates", configured: true, status: 200, records: 2 },
  );
  assert.equal(ok.calls[0].url, "https://feed.test/trips");
  const failed = await probeGtfsRtFeed("vehicle_positions", served("", 502).transport, { GTFS_RT_VEHICLE_URL: "https://feed.test/v" });
  assert.equal(failed.configured, true);
  assert.match(failed.error ?? "", /502/);
});
