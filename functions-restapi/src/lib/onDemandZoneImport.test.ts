import assert from "node:assert/strict";
import test from "node:test";
import type { sql } from "./db";
import { loadOperationalZones, expectedOperationalZoneIds } from "./onDemandOperationalZones";
import {
  activateOperationalZoneVersion,
  fetchGtfsFlexArchive,
  importOperationalZoneVersion,
  sourceSha256,
} from "./onDemandZoneImport";

// A pool stub covering the paths that never open a transaction. The
// transactional writes need a real database and are left to the contract tests.
function fakePool(recordsets: readonly unknown[][]): sql.ConnectionPool {
  const remaining = [...recordsets];
  return {
    request: () => {
      const request = {
        input: () => request,
        query: async () => ({ recordset: remaining.shift() ?? [] }),
      };
      return request;
    },
  } as unknown as sql.ConnectionPool;
}

const snapshot = { version: "zone-feed-v1", zones: [] };

test("hashes the archive bytes, not the parsed geometry", () => {
  // source_sha256 is half of the natural key that makes a daily poll of
  // unchanged geometry a no-op, so it has to be stable across calls and has to
  // move when the bytes move - including when a publisher reuses a feed_version
  // for changed contents.
  assert.equal(sourceSha256(Buffer.from("zones")), sourceSha256(Buffer.from("zones")));
  assert.notEqual(sourceSha256(Buffer.from("zones")), sourceSha256(Buffer.from("zones ")));
  assert.match(sourceSha256(Buffer.from("zones")), /^[0-9a-f]{64}$/);
});

test("re-importing identical bytes is a no-op rather than a new version", async () => {
  const result = await importOperationalZoneVersion(
    fakePool([[{ id: "11111111-1111-1111-1111-111111111111" }]]),
    snapshot,
    sourceSha256(Buffer.from("zones")),
    "onDemandZonesSync",
  );
  assert.equal(result.imported, false);
  assert.equal(result.activated, false);
  assert.equal(result.versionId, "11111111-1111-1111-1111-111111111111");
});

test("refuses to activate a version that has no zones", async () => {
  // Activating an empty version takes the monitor down exactly as having no
  // active version does, but reports success on the way.
  const result = await activateOperationalZoneVersion(
    fakePool([[{ feed_version: "zone-feed-v2", is_active: false, zone_count: 0 }]]),
    "22222222-2222-2222-2222-222222222222",
  );
  assert.equal(result.kind, "no_zones");
});

test("reports an unknown version rather than silently doing nothing", async () => {
  const result = await activateOperationalZoneVersion(fakePool([[]]), "33333333-3333-3333-3333-333333333333");
  assert.equal(result.kind, "not_found");
});

test("activating the already-active version does not disturb it", async () => {
  const result = await activateOperationalZoneVersion(
    fakePool([[{ feed_version: "zone-feed-v1", is_active: true, zone_count: 2 }]]),
    "44444444-4444-4444-4444-444444444444",
  );
  assert.equal(result.kind, "already_active");
});

test("a failed zone-feed request raises rather than importing an empty archive", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(
      fetchGtfsFlexArchive("https://example.test/flex.zip"),
      /GTFS-Flex zone feed request failed: 503/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the expected zone set is configurable, so a third zone is a settings change", () => {
  // Pinned in code, adding a zone or absorbing an upstream location-id rename
  // meant a code change and a deploy, and every import failed closed until it
  // landed.
  const previous = process.env.ON_DEMAND_OPERATIONAL_ZONE_IDS;
  try {
    delete process.env.ON_DEMAND_OPERATIONAL_ZONE_IDS;
    assert.deepEqual([...expectedOperationalZoneIds()], [
      "location_id__b413a052-36eb-43de-97f7-59fe9f99f839",
      "location_id__ad56cc1c-48cc-495b-948b-661aae320fd8",
    ]);

    process.env.ON_DEMAND_OPERATIONAL_ZONE_IDS = "location_id__alpha, location_id__beta ,location_id__gamma";
    assert.deepEqual([...expectedOperationalZoneIds()], [
      "location_id__alpha",
      "location_id__beta",
      "location_id__gamma",
    ]);

    const feed = {
      features: [
        {
          id: "location_id__alpha",
          properties: { stop_name: "Alpha" },
          geometry: { type: "Polygon", coordinates: [[[-94, 44], [-93, 44], [-93, 45], [-94, 45], [-94, 44]]] },
        },
        {
          id: "location_id__beta",
          properties: { stop_name: "Beta" },
          geometry: { type: "Polygon", coordinates: [[[-93, 44], [-92, 44], [-92, 45], [-93, 45], [-93, 44]]] },
        },
      ],
    };
    // Still fails closed: the configured set names three zones and the feed
    // carries two, so the import stops rather than shrinking the service area.
    assert.throws(() => loadOperationalZones("zone-feed-v9", feed), /missing expected Operational zones/);

    process.env.ON_DEMAND_OPERATIONAL_ZONE_IDS = "location_id__alpha,location_id__beta";
    assert.deepEqual(loadOperationalZones("zone-feed-v9", feed).zones.map((zone) => zone.name), ["Alpha", "Beta"]);
  } finally {
    if (previous === undefined) delete process.env.ON_DEMAND_OPERATIONAL_ZONE_IDS;
    else process.env.ON_DEMAND_OPERATIONAL_ZONE_IDS = previous;
  }
});
