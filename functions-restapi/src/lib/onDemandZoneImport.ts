// Fetch, persist, and activate the GTFS-Flex service-area geometry the
// on-demand wait monitor resolves pickups against.
//
// The parser (loadOperationalZonesFromGtfsFlexArchive) and the point-in-polygon
// resolver have existed and been covered by tests since migration 074, but
// nothing ever called them outside a test file: no fetch, no writer, no
// activation path. OnDemandOperationalZoneVersions was therefore empty, and
// because loadActiveOperationalZones joins zones to an active version, the
// monitor resolved every pickup against an empty snapshot. This module is that
// missing plumbing.
import { createHash } from "node:crypto";
import { sql } from "./db";
import type { OperationalZoneSnapshot } from "./onDemandOperationalZones";

// Zone archives are small (geometry and feed_info only), so a request still
// running after this long is hung rather than slow. An unbounded fetch inside a
// timer is worse than a failed one: it occupies the invocation without ever
// recording an outcome, which is the silent-failure shape this monitor already
// suffered from once.
const FETCH_TIMEOUT_MS = 60_000;

export interface ZoneImportResult {
  versionId: string;
  feedVersion: string;
  zoneCount: number;
  // False when these exact bytes at this feed_version were already imported.
  imported: boolean;
  // True when this call made the version active, which happens only when no
  // version was active beforehand.
  activated: boolean;
}

// Migration 098 adds activated_by/activated_at. Resolving support per call
// keeps activation working whichever of the migration and the deployment lands
// first, rather than failing on a column that is not there yet.
export async function activationAuditSupported(pool: sql.ConnectionPool): Promise<boolean> {
  const result = await pool.request().query<{ supported: number }>(`
    SELECT CASE WHEN COL_LENGTH('dbo.OnDemandOperationalZoneVersions', 'activated_by') IS NULL
      THEN 0 ELSE 1 END AS supported
  `);
  return result.recordset[0]?.supported === 1;
}

export function sourceSha256(archive: Buffer): string {
  return createHash("sha256").update(archive).digest("hex");
}

export async function fetchGtfsFlexArchive(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`GTFS-Flex zone feed request failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Import is idempotent on (feed_version, source_sha256) - the natural key
// UQ_OnDemandOperationalZoneVersions_Source already declares. Hashing the raw
// archive is what makes a daily poll of unchanged geometry a no-op instead of a
// new version row every morning, and it distinguishes a genuine re-publication
// from a republished feed_version whose contents moved underneath it.
//
// A newly imported version is inactive, except when nothing is active yet.
// Deliberate activation exists to stop operational geometry being swapped under
// a live monitor without a human in the loop; when there is no active version
// there is no live geometry to protect, and holding the very first import back
// for a manual step would only keep the monitor down for longer. So: first
// import activates itself, every subsequent one waits to be activated.
export async function importOperationalZoneVersion(
  pool: sql.ConnectionPool,
  snapshot: OperationalZoneSnapshot,
  archiveSha256: string,
  importedBy: string,
): Promise<ZoneImportResult> {
  const existing = await pool.request()
    .input("feed_version", sql.NVarChar(200), snapshot.version)
    .input("source_sha256", sql.Char(64), archiveSha256)
    .query<{ id: string }>(`
      SELECT id FROM dbo.OnDemandOperationalZoneVersions
      WHERE feed_version = @feed_version AND source_sha256 = @source_sha256
    `);
  const alreadyImported = existing.recordset[0]?.id;
  if (alreadyImported) {
    return {
      versionId: alreadyImported,
      feedVersion: snapshot.version,
      zoneCount: snapshot.zones.length,
      imported: false,
      activated: false,
    };
  }

  const auditSupported = await activationAuditSupported(pool);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // The id is declared rather than read back through an OUTPUT clause:
    // OnDemandOperationalZoneVersions is on the referenced side of two foreign
    // keys, which is the case SQL Server restricts OUTPUT around, and nothing
    // here needs the database to mint the value.
    const inserted = await new sql.Request(transaction)
      .input("feed_version", sql.NVarChar(200), snapshot.version)
      .input("source_sha256", sql.Char(64), archiveSha256)
      .input("imported_by", sql.NVarChar(200), importedBy)
      .query<{ id: string }>(`
        DECLARE @id UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.OnDemandOperationalZoneVersions (id, feed_version, source_sha256, imported_by)
        VALUES (@id, @feed_version, @source_sha256, @imported_by);
        SELECT CAST(@id AS NVARCHAR(36)) AS id;
      `);
    const versionId = inserted.recordset[0]?.id;
    if (!versionId) throw new Error("Failed to insert the on-demand operational zone version");

    for (const zone of snapshot.zones) {
      await new sql.Request(transaction)
        .input("zone_version_id", sql.UniqueIdentifier, versionId)
        .input("external_location_id", sql.NVarChar(100), zone.externalLocationId)
        .input("name", sql.NVarChar(200), zone.name)
        .input("geometry_json", sql.NVarChar(sql.MAX), JSON.stringify(zone.geometry))
        .query(`
          INSERT INTO dbo.OnDemandOperationalZones (zone_version_id, external_location_id, name, geometry_json)
          VALUES (@zone_version_id, @external_location_id, @name, @geometry_json)
        `);
    }

    // UX_OnDemandOperationalZoneVersions_Active is a filtered unique index on
    // is_active = 1, so this can only ever set the flag while no other row
    // holds it. UPDLOCK/HOLDLOCK makes the check and the write one decision
    // rather than two, so a concurrent import cannot read "nothing active"
    // twice and have the second write fail on the index.
    const auditColumns = auditSupported ? ", activated_by = @imported_by, activated_at = SYSUTCDATETIME()" : "";
    const activation = await new sql.Request(transaction)
      .input("id", sql.UniqueIdentifier, versionId)
      .input("imported_by", sql.NVarChar(200), importedBy)
      .query<{ activated: number }>(`
        UPDATE dbo.OnDemandOperationalZoneVersions
        SET is_active = 1${auditColumns}
        WHERE id = @id AND NOT EXISTS (
          SELECT 1 FROM dbo.OnDemandOperationalZoneVersions WITH (UPDLOCK, HOLDLOCK) WHERE is_active = 1
        );
        SELECT @@ROWCOUNT AS activated;
      `);
    await transaction.commit();
    return {
      versionId,
      feedVersion: snapshot.version,
      zoneCount: snapshot.zones.length,
      imported: true,
      activated: activation.recordset[0]?.activated === 1,
    };
  } catch (err) {
    try { await transaction.rollback(); } catch { /* the commit already failed; keep the original error */ }
    throw err;
  }
}

export type ZoneActivationResult =
  | { kind: "activated"; feedVersion: string; zoneCount: number }
  | { kind: "already_active" }
  | { kind: "not_found" }
  | { kind: "no_zones" };

// Clearing the previous active row and setting the new one has to happen in
// that order and in one transaction: the filtered unique index rejects two
// active versions, so the naive "activate then deactivate" ordering fails.
export async function activateOperationalZoneVersion(
  pool: sql.ConnectionPool,
  versionId: string,
  actor: string,
): Promise<ZoneActivationResult> {
  const target = await pool.request()
    .input("id", sql.UniqueIdentifier, versionId)
    .query<{ feed_version: string; is_active: boolean; zone_count: number }>(`
      SELECT v.feed_version, v.is_active,
        (SELECT COUNT(*) FROM dbo.OnDemandOperationalZones z WHERE z.zone_version_id = v.id) AS zone_count
      FROM dbo.OnDemandOperationalZoneVersions v WHERE v.id = @id
    `);
  const row = target.recordset[0];
  if (!row) return { kind: "not_found" };
  if (row.is_active) return { kind: "already_active" };
  // Activating a version with no zones would take the monitor down as surely as
  // having none at all, and would do it while reporting success.
  if (row.zone_count === 0) return { kind: "no_zones" };

  const auditColumns = await activationAuditSupported(pool)
    ? ", activated_by = @actor, activated_at = SYSUTCDATETIME()"
    : "";
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await new sql.Request(transaction)
      .input("id", sql.UniqueIdentifier, versionId)
      .input("actor", sql.NVarChar(200), actor)
      .query(`
        UPDATE dbo.OnDemandOperationalZoneVersions SET is_active = 0 WHERE is_active = 1 AND id <> @id;
        UPDATE dbo.OnDemandOperationalZoneVersions SET is_active = 1${auditColumns} WHERE id = @id;
      `);
    await transaction.commit();
  } catch (err) {
    try { await transaction.rollback(); } catch { /* keep the original error */ }
    throw err;
  }
  return { kind: "activated", feedVersion: row.feed_version, zoneCount: row.zone_count };
}
