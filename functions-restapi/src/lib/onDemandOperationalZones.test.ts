import test from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import { loadOperationalZones, loadOperationalZonesFromGtfsFlexArchive, resolveOperationalZone } from "./onDemandOperationalZones";

const zoneFeed = {
  type: "FeatureCollection",
  features: [
    {
      id: "location_id__b413a052-36eb-43de-97f7-59fe9f99f839",
      type: "Feature",
      properties: { stop_name: "Central Zone, Apple Valley" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[-94, 44], [-93, 44], [-93, 45], [-94, 45], [-94, 44]]],
        ],
      },
    },
    {
      id: "location_id__57e7beb0-7416-44e0-a1f5-ac6a6f48a5cd",
      type: "Feature",
      properties: { stop_name: "Eagan City Boundary - REFERENCE" },
      geometry: {
        type: "Polygon",
        coordinates: [[[-94, 44], [-93, 44], [-93, 45], [-94, 45], [-94, 44]]],
      },
    },
    {
      id: "location_id__ad56cc1c-48cc-495b-948b-661aae320fd8",
      type: "Feature",
      properties: { stop_name: "Shakopee - Prior Lake Boundaries" },
      geometry: {
        type: "Polygon",
        coordinates: [[[-93, 44], [-92, 44], [-92, 45], [-93, 45], [-93, 44]]],
      },
    },
  ],
};

test("loads the eligible MVTA Connect areas at their feed version and excludes the Eagan reference boundary", () => {
  const snapshot = loadOperationalZones("exported-at_2026-08-24T23:55:53.966Z", zoneFeed);

  assert.deepEqual(snapshot.zones.map((zone) => zone.externalLocationId), [
    "location_id__b413a052-36eb-43de-97f7-59fe9f99f839",
    "location_id__ad56cc1c-48cc-495b-948b-661aae320fd8",
  ]);
  assert.equal(snapshot.version, "exported-at_2026-08-24T23:55:53.966Z");
});

test("loads the zone snapshot from a GTFS-Flex archive", () => {
  const archive = new AdmZip();
  archive.addFile("feed_info.txt", Buffer.from("feed_publisher_name,feed_version\n\"Spare, Inc.\",zone-feed-v1\n"));
  archive.addFile("locations.geojson", Buffer.from(JSON.stringify(zoneFeed)));

  assert.equal(loadOperationalZonesFromGtfsFlexArchive(archive.toBuffer()).version, "zone-feed-v1");
});

test("rejects an incomplete initial Operational-zone feed", () => {
  assert.throws(
    () => loadOperationalZones("v1", { ...zoneFeed, features: zoneFeed.features.slice(0, 1) }),
    /missing expected Operational zones/,
  );
});

test("rejects duplicate or malformed Operational-zone geometry", () => {
  assert.throws(
    () => loadOperationalZones("v1", { ...zoneFeed, features: [...zoneFeed.features, zoneFeed.features[0]] }),
    /duplicate Operational zones/,
  );
  assert.throws(
    () => loadOperationalZones("v1", {
      ...zoneFeed,
      features: [{ ...zoneFeed.features[0], geometry: { type: "Polygon", coordinates: [] } }, zoneFeed.features[2]],
    }),
    /invalid Operational-zone geometry/,
  );
});

test("assigns one matching zone and keeps the feed-version snapshot", () => {
  const snapshot = loadOperationalZones("v1", zoneFeed);

  assert.deepEqual(resolveOperationalZone(snapshot, [-93.5, 44.5]), {
    kind: "assigned",
    zone: {
      externalLocationId: "location_id__b413a052-36eb-43de-97f7-59fe9f99f839",
      name: "Central Zone, Apple Valley",
      version: "v1",
    },
  });
});

test("keeps missing, outside, and overlapping pickup coordinates Unzoned", () => {
  const snapshot = loadOperationalZones("v1", zoneFeed);
  const overlapping = {
    ...snapshot,
    zones: [...snapshot.zones, { ...snapshot.zones[0], externalLocationId: "overlap", name: "Overlap" }],
  };

  assert.deepEqual(resolveOperationalZone(snapshot, null), { kind: "unzoned", reason: "missing_pickup_coordinate" });
  assert.deepEqual(resolveOperationalZone(snapshot, [-91, 44.5]), { kind: "unzoned", reason: "outside_operational_zones" });
  assert.deepEqual(resolveOperationalZone(overlapping, [-93.5, 44.5]), { kind: "unzoned", reason: "ambiguous_operational_zones" });
});
