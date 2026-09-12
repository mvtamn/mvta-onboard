import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { loadOperationalZonesFromGtfsFlexArchive } from "../lib/onDemandOperationalZones";
import { MAX_ARCHIVE_BYTES, importOutcomeMessage, rejectArchive } from "./onDemandZoneUpload";

test("an empty or oversized upload is refused before it is parsed", () => {
  assert.deepEqual(rejectArchive(0), { status: 400, error: "No archive was uploaded." });
  assert.equal(rejectArchive(MAX_ARCHIVE_BYTES + 1)?.status, 413);
  assert.equal(rejectArchive(MAX_ARCHIVE_BYTES), null);
  assert.equal(rejectArchive(42_000), null);
});

test("already-imported bytes are not reported as a completed seeding", () => {
  const message = importOutcomeMessage({ imported: false, activated: false });
  assert.match(message, /already stored/);
  // The operator must still be sent to check activation: identical bytes under
  // an inactive version leave the monitor without geometry.
  assert.match(message, /active one/);
});

test("an import that activates is distinguished from one that waits", () => {
  assert.match(importOutcomeMessage({ imported: true, activated: true }), /Imported and activated/);
  assert.match(importOutcomeMessage({ imported: true, activated: false }), /inactive/);
});

test("MVTA's fixed-route archive is refused as the wrong feed", () => {
  // google_transit.zip has no locations.geojson. The upload path must fail on
  // it by name rather than importing an empty zone set.
  const wrongFeed = new AdmZip();
  wrongFeed.addFile("feed_info.txt", Buffer.from("feed_version\n20260901\n"));
  wrongFeed.addFile("stops.txt", Buffer.from("stop_id\n1\n"));
  assert.throws(
    () => loadOperationalZonesFromGtfsFlexArchive(wrongFeed.toBuffer()),
    /locations\.geojson/,
  );
});

test("an archive without feed_version is refused", () => {
  const noVersion = new AdmZip();
  noVersion.addFile("feed_info.txt", Buffer.from("feed_publisher_name\nMVTA\n"));
  noVersion.addFile("locations.geojson", Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [] })));
  assert.throws(() => loadOperationalZonesFromGtfsFlexArchive(noVersion.toBuffer()), /feed_version/);
});
