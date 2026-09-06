// Writes a GTFS-Flex archive into the versioned operational-zone tables.
//
// The parse, the geometry validation, and the read path have existed since
// #92, but nothing ever wrote the tables: `loadOperationalZonesFromGtfsFlex-
// Archive` was referenced only from its own test file, so
// `loadActiveOperationalZones` has always returned an empty set and the
// on-demand monitor has never run against real geometry. This is the missing
// write half.
//
// Import and activation are deliberately separate. Migration 074 defaults
// `is_active` to 0, records `imported_by`, and enforces a single active
// version through a filtered unique index. That schema describes import,
// review, then switch - not an importer that swaps operational geometry
// underneath live monitoring on its own.
import { createHash } from "node:crypto";
import { sql } from "./db";
import { loadOperationalZonesFromGtfsFlexArchive, type OperationalZoneSnapshot } from "./onDemandOperationalZones";

// A GTFS-Flex archive for MVTA Connect is two polygons and a feed_info.txt -
// a few hundred kilobytes. The cap is what stops an accidental upload of a
// full fixed-route GTFS feed (MVTA's is 2.8 MB compressed, 12 MB expanded)
// from being unzipped in memory on a single B1 worker.
export const MAX_ZONE_ARCHIVE_BYTES = 10 * 1024 * 1024;

export interface ZoneVersionSummary {
  version_id: string;
  feed_version: string;
  source_sha256: string;
  zone_count: number;
  is_active: boolean;
  imported_at: string;
  imported_by: string | null;
}

export interface ImportedZoneVersion extends ZoneVersionSummary {
  // True when these exact bytes were already stored under this feed version,
  // so this import wrote nothing. Re-uploading the same archive is a no-op
  // rather than a second version competing for activation.
  already_imported: boolean;
  zones: { external_location_id: string; name: string }[];
}

interface VersionRow {
  id: string;
  feed_version: string;
  source_sha256: string;
  is_active: boolean;
  imported_at: Date;
  imported_by: string | null;
  zone_count: number;
}

function summarize(row: VersionRow): ZoneVersionSummary {
  return {
    version_id: row.id,
    feed_version: row.feed_version,
    source_sha256: row.source_sha256,
    zone_count: row.zone_count,
    is_active: Boolean(row.is_active),
    imported_at: row.imported_at.toISOString(),
    imported_by: row.imported_by,
  };
}

const VERSION_SELECT = `
  SELECT v.id, v.feed_version, v.source_sha256, v.is_active, v.imported_at, v.imported_by,
    (SELECT COUNT(*) FROM dbo.OnDemandOperationalZones z WHERE z.zone_version_id = v.id) AS zone_count
  FROM dbo.OnDemandOperationalZoneVersions v
`;

// The source hash is what makes a re-import idempotent:
// UQ_OnDemandOperationalZoneVersions_Source is (feed_version, source_sha256),
// so identical bytes under the same feed version cannot become a second row.
export function zoneArchiveSha256(archive: Buffer): string {
  return createHash("sha256").update(archive).digest("hex");
}

async function findVersionBySource(
  pool: sql.ConnectionPool,
  feedVersion: string,
  sourceSha256: string,
): Promise<VersionRow | null> {
  const result = await pool.request()
    .input("feed_version", sql.NVarChar(200), feedVersion)
    .input("source_sha256", sql.Char(64), sourceSha256)
    .query<VersionRow>(`${VERSION_SELECT} WHERE v.feed_version = @feed_version AND v.source_sha256 = @source_sha256;`);
  return result.recordset[0] ?? null;
}

export async function listOperationalZoneVersions(
  pool: sql.ConnectionPool,
): Promise<ZoneVersionSummary[]> {
  const result = await pool.request()
    .query<VersionRow>(`${VERSION_SELECT} ORDER BY v.imported_at DESC;`);
  return result.recordset.map(summarize);
}

export interface ParsedZoneArchive {
  snapshot: OperationalZoneSnapshot;
  sourceSha256: string;
}

// Parsing is deliberately separate from storing, and pure. A malformed feed,
// invalid geometry, a duplicate zone, or a feed missing an expected zone is
// the operator's problem and gets a message naming it; a database that is
// down is not, and must not be reported as a bad upload. Keeping them apart
// also means an archive that was never going to be stored never opens a pool.
export function parseOperationalZoneArchive(archive: Buffer): ParsedZoneArchive {
  if (archive.byteLength === 0) {
    throw new Error("The GTFS-Flex archive is empty.");
  }
  if (archive.byteLength > MAX_ZONE_ARCHIVE_BYTES) {
    throw new Error(`The GTFS-Flex archive exceeds the ${MAX_ZONE_ARCHIVE_BYTES}-byte limit.`);
  }
  return {
    snapshot: loadOperationalZonesFromGtfsFlexArchive(archive),
    sourceSha256: zoneArchiveSha256(archive),
  };
}

export async function storeOperationalZoneSnapshot(
  pool: sql.ConnectionPool,
  { snapshot, sourceSha256 }: ParsedZoneArchive,
  importedBy: string,
): Promise<ImportedZoneVersion> {
  const existing = await findVersionBySource(pool, snapshot.version, sourceSha256);
  if (existing) {
    return {
      ...summarize(existing),
      already_imported: true,
      zones: snapshot.zones.map((zone) => ({
        external_location_id: zone.externalLocationId,
        name: zone.name,
      })),
    };
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const inserted = await new sql.Request(tx)
      .input("feed_version", sql.NVarChar(200), snapshot.version)
      .input("source_sha256", sql.Char(64), sourceSha256)
      .input("imported_by", sql.NVarChar(200), importedBy)
      .query<{ id: string; imported_at: Date }>(`
        INSERT INTO dbo.OnDemandOperationalZoneVersions (feed_version, source_sha256, imported_by)
        OUTPUT INSERTED.id, INSERTED.imported_at
        VALUES (@feed_version, @source_sha256, @imported_by);
      `);
    const version = inserted.recordset[0];
    for (const zone of snapshot.zones) {
      await new sql.Request(tx)
        .input("zone_version_id", sql.UniqueIdentifier, version.id)
        .input("external_location_id", sql.NVarChar(100), zone.externalLocationId)
        .input("name", sql.NVarChar(200), zone.name)
        .input("geometry_json", sql.NVarChar(sql.MAX), JSON.stringify(zone.geometry))
        .query(`
          INSERT INTO dbo.OnDemandOperationalZones (zone_version_id, external_location_id, name, geometry_json)
          VALUES (@zone_version_id, @external_location_id, @name, @geometry_json);
        `);
    }
    await tx.commit();
    return {
      version_id: version.id,
      feed_version: snapshot.version,
      source_sha256: sourceSha256,
      zone_count: snapshot.zones.length,
      // Never active on import; activation is a separate, deliberate act.
      is_active: false,
      imported_at: version.imported_at.toISOString(),
      imported_by: importedBy,
      already_imported: false,
      zones: snapshot.zones.map((zone) => ({
        external_location_id: zone.externalLocationId,
        name: zone.name,
      })),
    };
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back / not begun */ }
    // Two operators uploading the same archive at once: the loser hits the
    // source uniqueness constraint. That is the idempotent outcome, not a
    // failure, so report the version the winner wrote.
    const raced = await findVersionBySource(pool, snapshot.version, sourceSha256);
    if (!raced) throw err;
    return {
      ...summarize(raced),
      already_imported: true,
      zones: snapshot.zones.map((zone) => ({
        external_location_id: zone.externalLocationId,
        name: zone.name,
      })),
    };
  }
}

export type ActivationResult =
  | { kind: "activated"; version: ZoneVersionSummary }
  | { kind: "not_found" }
  | { kind: "empty_version" };

export async function activateOperationalZoneVersion(
  pool: sql.ConnectionPool,
  versionId: string,
): Promise<ActivationResult> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const target = await new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, versionId)
      .query<VersionRow>(`${VERSION_SELECT} WHERE v.id = @id;`);
    const row = target.recordset[0];
    if (!row) {
      await tx.rollback();
      return { kind: "not_found" };
    }
    // Activating a version with no zones reproduces exactly the state this
    // importer exists to end: loadActiveOperationalZones returns an empty
    // set and every monitor write is skipped. Refuse rather than pretend.
    if (row.zone_count === 0) {
      await tx.rollback();
      return { kind: "empty_version" };
    }
    // Deactivate first. UX_OnDemandOperationalZoneVersions_Active is a
    // filtered unique index on is_active = 1, so marking the new version
    // active before clearing the old one violates it.
    await new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, versionId)
      .query("UPDATE dbo.OnDemandOperationalZoneVersions SET is_active = 0 WHERE is_active = 1 AND id <> @id;");
    await new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, versionId)
      .query("UPDATE dbo.OnDemandOperationalZoneVersions SET is_active = 1 WHERE id = @id;");
    await tx.commit();
    return { kind: "activated", version: { ...summarize(row), is_active: true } };
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back / not begun */ }
    throw err;
  }
}
