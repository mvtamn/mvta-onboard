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

function flexArchive(feedVersion: string, locations: unknown = zoneFeed): Buffer {
  const archive = new AdmZip();
  archive.addFile("feed_info.txt", Buffer.from(`feed_publisher_name,feed_version\n"Spare, Inc.",${feedVersion}\n`));
  archive.addFile("locations.geojson", Buffer.from(JSON.stringify(locations)));
  return archive.toBuffer();
}

test("loads the zone snapshot from a GTFS-Flex archive", () => {
  assert.equal(loadOperationalZonesFromGtfsFlexArchive(flexArchive("zone-feed-v1")).snapshot.version, "zone-feed-v1");
});

test("lists every location Spare publishes that is not an Operational zone, by id and name", () => {
  // A new service area Spare starts publishing must not go unnoticed just
  // because MVTA has not chosen to monitor it; the reference boundary is listed
  // too, rather than hidden by guessing from its name.
  const feed = loadOperationalZonesFromGtfsFlexArchive(flexArchive("zone-feed-v1", {
    ...zoneFeed,
    features: [...zoneFeed.features, {
      id: "location_id__new-area",
      type: "Feature",
      properties: { stop_name: "Rosemount Pilot" },
      geometry: { type: "Polygon", coordinates: [[[-93, 44], [-92, 44], [-92, 45], [-93, 45], [-93, 44]]] },
    }],
  }));
  assert.deepEqual(feed.unmonitoredLocations, [
    { id: "location_id__57e7beb0-7416-44e0-a1f5-ac6a6f48a5cd", name: "Eagan City Boundary - REFERENCE" },
    { id: "location_id__new-area", name: "Rosemount Pilot" },
  ]);
});

// Spare stamps the export time into feed_version on every call (confirmed live
// 2026-09-17), so identity must come from the monitored zones alone.
test("a fresh export of the same zones has the same zone version identity", () => {
  const monday = loadOperationalZonesFromGtfsFlexArchive(flexArchive("exported-at_2026-09-14T09:30:00.101Z"));
  const tuesday = loadOperationalZonesFromGtfsFlexArchive(flexArchive("exported-at_2026-09-15T09:30:02.877Z", {
    ...zoneFeed,
    // Spare lists the same zones in a different order this time.
    features: [...zoneFeed.features].reverse(),
  }));
  assert.match(monday.zoneVersionSha256, /^[0-9a-f]{64}$/);
  assert.equal(tuesday.zoneVersionSha256, monday.zoneVersionSha256);
});

test("a change to a monitored zone's name or geometry is a new zone version", () => {
  const today = loadOperationalZonesFromGtfsFlexArchive(flexArchive("v1")).zoneVersionSha256;
  const renamed = loadOperationalZonesFromGtfsFlexArchive(flexArchive("v1", {
    ...zoneFeed,
    features: zoneFeed.features.map((feature) => feature.id.endsWith("661aae320fd8")
      ? { ...feature, properties: { stop_name: "Shakopee - Prior Lake - Savage" } }
      : feature),
  })).zoneVersionSha256;
  const reshaped = loadOperationalZonesFromGtfsFlexArchive(flexArchive("v1", {
    ...zoneFeed,
    features: zoneFeed.features.map((feature) => feature.id.endsWith("661aae320fd8")
      ? { ...feature, geometry: { type: "Polygon", coordinates: [[[-93, 44], [-91.5, 44], [-91.5, 45], [-93, 45], [-93, 44]]] } }
      : feature),
  })).zoneVersionSha256;
  assert.notEqual(renamed, today);
  assert.notEqual(reshaped, today);
  assert.notEqual(reshaped, renamed);
});

test("a change to a location Spare publishes but MVTA does not monitor is not a new zone version", () => {
  const today = loadOperationalZonesFromGtfsFlexArchive(flexArchive("v1")).zoneVersionSha256;
  const referenceMoved = loadOperationalZonesFromGtfsFlexArchive(flexArchive("v2", {
    ...zoneFeed,
    features: zoneFeed.features.map((feature) => feature.id.includes("57e7beb0")
      ? { ...feature, geometry: { type: "Polygon", coordinates: [[[-95, 44], [-93, 44], [-93, 46], [-95, 46], [-95, 44]]] } }
      : feature),
  })).zoneVersionSha256;
  assert.equal(referenceMoved, today);
});

test("rejects an incomplete initial Operational-zone feed", () => {
  assert.throws(
    () => loadOperationalZones("v1", { ...zoneFeed, features: zoneFeed.features.slice(0, 1) }),
    /missing expected Operational zones/,
  );
});

test("a missing zone's failure names what is missing and what Spare did publish", () => {
  // If Spare renames a zone's location id the pull fails, and the new id is
  // exactly what the person fixing ON_DEMAND_OPERATIONAL_ZONE_IDS needs. The
  // failure reason is what the Zone geometry panel shows, so it carries both.
  // Ids and names only, never geometry.
  const renamed = {
    ...zoneFeed,
    features: zoneFeed.features.map((feature) => feature.id.endsWith("661aae320fd8")
      ? { ...feature, id: "location_id__renamed-shakopee" }
      : feature),
  };
  assert.throws(
    () => loadOperationalZones("v2", renamed),
    (error: Error) => {
      assert.match(error.message, /^GTFS-Flex feed is missing expected Operational zones: location_id__ad56cc1c-48cc-495b-948b-661aae320fd8\./);
      assert.match(error.message, /Spare published: Central Zone, Apple Valley \(location_id__b413a052-36eb-43de-97f7-59fe9f99f839\); Eagan City Boundary - REFERENCE \(location_id__57e7beb0-7416-44e0-a1f5-ac6a6f48a5cd\); Shakopee - Prior Lake Boundaries \(location_id__renamed-shakopee\)\.$/);
      assert.doesNotMatch(error.message, /coordinates|Polygon/);
      return true;
    },
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
