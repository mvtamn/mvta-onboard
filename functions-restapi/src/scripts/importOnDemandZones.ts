// One-off manual import of the on-demand operational zone geometry.
//
//   node dist/src/scripts/importOnDemandZones.js ./mvta-connect-flex.zip
//
// Seeds OnDemandOperationalZoneVersions from a GTFS-Flex archive on disk, for
// the case the daily importer cannot serve: no published feed URL is known, and
// the monitor has been inert since migration 074 waiting for one. It shares
// every code path with onDemandZonesSync - same parser, same hash, same
// transactional write, same first-import activation rule - so a version seeded
// this way is indistinguishable from a polled one, and a later poll of the same
// bytes is recognised as already imported rather than duplicated.
//
// Requires SQL_CONNECTION_STRING in the environment. Reads nothing else.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getPool } from "../lib/db";
import { loadOperationalZonesFromGtfsFlexArchive } from "../lib/onDemandOperationalZones";
import { importOperationalZoneVersion, sourceSha256 } from "../lib/onDemandZoneImport";

async function main(): Promise<number> {
  const [archivePath] = process.argv.slice(2);
  if (!archivePath) {
    console.error("Usage: node dist/src/scripts/importOnDemandZones.js <path-to-gtfs-flex-archive.zip>");
    return 2;
  }
  if (!process.env.SQL_CONNECTION_STRING) {
    console.error("SQL_CONNECTION_STRING is not set; this script writes directly to the database.");
    return 2;
  }

  const archive = await readFile(archivePath);
  // Parsed before the database is touched: a malformed archive, or one missing
  // an expected zone, should fail here rather than after opening a transaction.
  const snapshot = loadOperationalZonesFromGtfsFlexArchive(archive);
  console.log(
    `${basename(archivePath)}: feed version ${snapshot.version}, ` +
      `${snapshot.zones.length} zones (${snapshot.zones.map((zone) => zone.name).join("; ")})`,
  );

  const result = await importOperationalZoneVersion(
    await getPool(),
    snapshot,
    sourceSha256(archive),
    `manual:${process.env.USER ?? process.env.USERNAME ?? "operator"}`,
  );

  if (!result.imported) {
    console.log(`Already imported as version ${result.versionId}; nothing changed.`);
    return 0;
  }
  if (result.activated) {
    console.log(`Imported and activated version ${result.versionId}. The on-demand zone monitor is now live.`);
    return 0;
  }
  console.log(
    `Imported version ${result.versionId} as INACTIVE, because another version is already active. ` +
      "Activate it with POST /api/on-demand-zone-versions when the change is intended.",
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("On-demand zone import failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
