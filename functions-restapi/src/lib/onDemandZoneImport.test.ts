import test from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import {
  MAX_ZONE_ARCHIVE_BYTES,
  parseOperationalZoneArchive,
  zoneArchiveSha256,
} from "./onDemandZoneImport";

const zoneFeed = {
  type: "FeatureCollection",
  features: [
    {
      id: "location_id__b413a052-36eb-43de-97f7-59fe9f99f839",
      type: "Feature",
      properties: { stop_name: "Central Zone, Apple Valley" },
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

function flexArchive(feedVersion = "zone-feed-v1", feed: unknown = zoneFeed): Buffer {
  const archive = new AdmZip();
  archive.addFile("feed_info.txt", Buffer.from(`feed_publisher_name,feed_version\n"Spare, Inc.",${feedVersion}\n`));
  archive.addFile("locations.geojson", Buffer.from(JSON.stringify(feed)));
  return archive.toBuffer();
}

test("the source hash is stable and covers the archive bytes", () => {
  const archive = flexArchive();
  assert.equal(zoneArchiveSha256(archive), zoneArchiveSha256(Buffer.from(archive)));
  assert.match(zoneArchiveSha256(archive), /^[0-9a-f]{64}$/);
  assert.notEqual(zoneArchiveSha256(archive), zoneArchiveSha256(flexArchive("zone-feed-v2")));
});

test("a valid archive parses to its feed version, both zones, and a source hash", () => {
  const archive = flexArchive("exported-at_2026-08-24T23:55:53.966Z");
  const parsed = parseOperationalZoneArchive(archive);

  assert.equal(parsed.snapshot.version, "exported-at_2026-08-24T23:55:53.966Z");
  assert.deepEqual(parsed.snapshot.zones.map((zone) => zone.externalLocationId), [
    "location_id__b413a052-36eb-43de-97f7-59fe9f99f839",
    "location_id__ad56cc1c-48cc-495b-948b-661aae320fd8",
  ]);
  assert.equal(parsed.sourceSha256, zoneArchiveSha256(archive));
});

test("an empty upload is refused", () => {
  assert.throws(() => parseOperationalZoneArchive(Buffer.alloc(0)), /archive is empty/);
});

test("an oversized upload is refused before it is unzipped", () => {
  assert.throws(
    () => parseOperationalZoneArchive(Buffer.alloc(MAX_ZONE_ARCHIVE_BYTES + 1)),
    /exceeds the .* limit/,
  );
});

test("bytes that are not a GTFS-Flex archive are refused", () => {
  assert.throws(() => parseOperationalZoneArchive(Buffer.from("not a zip file")), Error);
});

test("an archive missing an expected Operational zone is refused", () => {
  const incomplete = flexArchive("zone-feed-v1", {
    ...zoneFeed,
    features: zoneFeed.features.slice(0, 1),
  });
  assert.throws(() => parseOperationalZoneArchive(incomplete), /missing expected Operational zones/);
});

test("an archive with invalid zone geometry is refused", () => {
  const broken = flexArchive("zone-feed-v1", {
    ...zoneFeed,
    features: [
      { ...zoneFeed.features[0], geometry: { type: "Polygon", coordinates: [[[-94, 44], [-93, 44]]] } },
      zoneFeed.features[1],
    ],
  });
  assert.throws(() => parseOperationalZoneArchive(broken), /invalid Operational-zone geometry/);
});

test("an archive missing locations.geojson is refused", () => {
  const archive = new AdmZip();
  archive.addFile("feed_info.txt", Buffer.from("feed_publisher_name,feed_version\n\"Spare, Inc.\",v1\n"));
  assert.throws(() => parseOperationalZoneArchive(archive.toBuffer()), /missing locations.geojson/);
});

test("an archive whose feed_info.txt has no feed_version is refused", () => {
  const archive = new AdmZip();
  archive.addFile("feed_info.txt", Buffer.from("feed_publisher_name\n\"Spare, Inc.\"\n"));
  archive.addFile("locations.geojson", Buffer.from(JSON.stringify(zoneFeed)));
  assert.throws(() => parseOperationalZoneArchive(archive.toBuffer()), /missing feed_version/);
});
