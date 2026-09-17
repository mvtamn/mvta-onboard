import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import type { ZoneFeed } from "./onDemandOperationalZones";
import { zoneVersionSha256 } from "./onDemandOperationalZones";
import { importOperationalZoneVersion } from "./onDemandZoneImport";

// Zone version import against a real SQL Server (the CI contract job's
// container), on the schema migrations 074, 098 and 127 build.
//
// What only a database shows: that a daily pull of the same zones - which Spare
// exports with a new feed_version and new archive bytes every time - is one
// version, not a new row a day; that a genuine geometry change lands inactive
// beside the one in force; and that the identity index refuses a second row for
// the same zones even if two writers race past the lookup.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };

// Child tables first: OnDemandRequestZoneSnapshots references both of the
// others, and onDemandRisks.db.contract.test.ts rebuilds zones and versions
// without it, so a snapshots table left behind would break that file's drop.
const RESET = `
IF OBJECT_ID('dbo.OnDemandRequestZoneSnapshots','U') IS NOT NULL DROP TABLE dbo.OnDemandRequestZoneSnapshots;
IF OBJECT_ID('dbo.OnDemandOperationalZones','U') IS NOT NULL DROP TABLE dbo.OnDemandOperationalZones;
IF OBJECT_ID('dbo.OnDemandOperationalZoneVersions','U') IS NOT NULL DROP TABLE dbo.OnDemandOperationalZoneVersions;
`;

async function apply(pool: sql.ConnectionPool, file: string) {
  const text = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try { await pool.request().batch(RESET); } finally { await pool.close(); }
});

const square = (x: number) => ({ type: "Polygon" as const, coordinates: [[[x, 44], [x + 1, 44], [x + 1, 45], [x, 45], [x, 44]]] as [number, number][][] });

function feed(feedVersion: string, shakopeeGeometry = square(-93), unmonitored = [{ id: "location_id__eagan", name: "Eagan City Boundary - REFERENCE" }]): ZoneFeed {
  const snapshot = {
    version: feedVersion,
    zones: [
      { externalLocationId: "location_id__central", name: "Central Zone, Apple Valley", version: feedVersion, geometry: square(-94) },
      { externalLocationId: "location_id__shakopee", name: "Shakopee - Prior Lake Boundaries", version: feedVersion, geometry: shakopeeGeometry },
    ],
  };
  return { snapshot, zoneVersionSha256: zoneVersionSha256(snapshot), unmonitoredLocations: unmonitored };
}

async function versions(pool: sql.ConnectionPool) {
  return (await pool.request().query<{
    feed_version: string; is_active: boolean; last_seen_feed_version: string | null;
    unmonitored_locations_json: string | null; zones: number;
  }>(`
    SELECT v.feed_version, v.is_active, v.last_seen_feed_version, v.unmonitored_locations_json,
      (SELECT COUNT(*) FROM dbo.OnDemandOperationalZones z WHERE z.zone_version_id = v.id) AS zones
    FROM dbo.OnDemandOperationalZoneVersions v ORDER BY v.imported_at, v.feed_version
  `)).recordset;
}

test("a daily pull of the same zones is one version, and a changed zone set waits beside it", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(RESET);
    for (const file of ["migration-074-on-demand-operational-zones.sql", "migration-098-on-demand-zone-activation-audit.sql"]) {
      await apply(pool, file);
    }
    await apply(pool, "migration-127-zone-version-identity.sql");
    await apply(pool, "migration-127-zone-version-identity.sql"); // re-runnable

    // First pull: nothing is active, so it goes into force.
    const first = await importOperationalZoneVersion(pool, feed("exported-at_2026-09-17T09:30:01Z"), "a".repeat(64), "onDemandZonesSync");
    assert.equal(first.imported, true);
    assert.equal(first.activated, true);

    // Next morning Spare exports the same zones with a new feed_version, new
    // archive bytes, and a new service area it has started publishing.
    const next = await importOperationalZoneVersion(
      pool,
      feed("exported-at_2026-09-18T09:30:02Z", square(-93), [
        { id: "location_id__eagan", name: "Eagan City Boundary - REFERENCE" },
        { id: "location_id__rosemount", name: "Rosemount Pilot" },
      ]),
      "b".repeat(64),
      "onDemandZonesSync",
    );
    assert.equal(next.imported, false);
    assert.equal(next.versionId, first.versionId);
    const afterSamePull = await versions(pool);
    assert.equal(afterSamePull.length, 1, "the same zones must not become a second version");
    assert.equal(afterSamePull[0].feed_version, "exported-at_2026-09-17T09:30:01Z", "the version keeps the export it was first imported from");
    assert.equal(afterSamePull[0].last_seen_feed_version, "exported-at_2026-09-18T09:30:02Z");
    assert.deepEqual(JSON.parse(afterSamePull[0].unmonitored_locations_json!), [
      { id: "location_id__eagan", name: "Eagan City Boundary - REFERENCE" },
      { id: "location_id__rosemount", name: "Rosemount Pilot" },
    ]);

    // Spare redraws Shakopee: a new version, inactive, waiting for a person.
    const changed = await importOperationalZoneVersion(pool, feed("exported-at_2026-09-19T09:30:00Z", square(-92.5)), "c".repeat(64), "onDemandZonesSync");
    assert.equal(changed.imported, true);
    assert.equal(changed.activated, false);
    const afterChange = await versions(pool);
    assert.deepEqual(afterChange.map((row) => [row.feed_version, row.is_active, row.zones]), [
      ["exported-at_2026-09-17T09:30:01Z", true, 2],
      ["exported-at_2026-09-19T09:30:00Z", false, 2],
    ]);

    // The identity index is the backstop if two writers race past the lookup.
    await assert.rejects(pool.request()
      .input("sha", sql.Char(64), feed("x").zoneVersionSha256)
      .query("INSERT INTO dbo.OnDemandOperationalZoneVersions (feed_version, source_sha256, zone_version_sha256) VALUES ('race', REPLICATE('d', 64), @sha)"),
      /UX_OnDemandOperationalZoneVersions_Identity|duplicate key/);
  } finally {
    await pool.close();
  }
});
