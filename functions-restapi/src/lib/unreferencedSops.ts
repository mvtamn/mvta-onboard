import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { reconcile, syncStatusFor, type KnownDocument, type ObservedDocument, type WalkResult } from "./decisionMatrixLocationSync";
import { DECISION_MATRIX_SURFACES, surfaceReady } from "./decisionMatrixReadiness";
import { normalizeLibraryPath } from "./sharepointLibrary";

// Unreferenced SOPs: documents in the SOP folder of the Approved Document
// Library that no current Procedure revision references.
//
// A daily walk records what is in the folder (migration 116's tables); the
// report reads that record back against Supporting Document References. The
// walk says nothing about whether a referenced document changed or went -
// Document Reference Health owns that, with its own identity and cadence. The
// one fact only this walk can give is "a new SOP has no Procedure".

/** Hours after which a walk that should have run daily is reported as not running. */
export const SOP_WALK_OVERDUE_HOURS = 26;

const CONFIGURED_BY = "configuration";

export type SopFolderSetting =
  | { configured: true; folder_path: string }
  | { configured: false; reason: string };

/**
 * DECISION_MATRIX_SOP_FOLDER, relative to the library root. An app setting
 * cannot hold an empty value distinctly from a missing one, so "/" is the
 * whole library and unset is not configured - walking every form and map in
 * the library is a choice someone has to make on purpose.
 */
export function sopFolderSetting(env: NodeJS.ProcessEnv = process.env): SopFolderSetting {
  const raw = env.DECISION_MATRIX_SOP_FOLDER?.trim();
  if (!raw) return { configured: false, reason: "No SOP folder is configured. Set DECISION_MATRIX_SOP_FOLDER to the folder inside the approved library that holds SOPs, or / for the whole library." };
  try {
    return { configured: true, folder_path: normalizeLibraryPath(raw) };
  } catch (error) {
    return { configured: false, reason: `DECISION_MATRIX_SOP_FOLDER is not a usable folder path: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface SopLocation {
  location_id: string;
  site_id: string;
  drive_id: string;
  folder_path: string;
}

/**
 * The one watched location: the SOP folder in the configured library. When the
 * setting points somewhere new, the old row is retired and a new one added, so
 * the next walk starts fresh rather than carrying first-seen dates across
 * folders. Only rows configuration added are retired.
 */
export async function ensureSopLocation(pool: sql.ConnectionPool, site: string, drive: string, folder: string): Promise<SopLocation> {
  const result = await pool.request()
    .input("location_id", sql.NVarChar, `sop-folder-${randomUUID()}`)
    .input("site_id", sql.NVarChar, site)
    .input("drive_id", sql.NVarChar, drive)
    .input("folder_path", sql.NVarChar, folder)
    .input("added_by", sql.NVarChar, CONFIGURED_BY)
    .query<SopLocation>(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      UPDATE DecisionMatrixDocumentLocations WITH (UPDLOCK, HOLDLOCK) SET is_active=0
        WHERE is_active=1 AND added_by=@added_by AND NOT (site_id=@site_id AND drive_id=@drive_id AND folder_path=@folder_path);
      IF NOT EXISTS (SELECT 1 FROM DecisionMatrixDocumentLocations WITH (UPDLOCK, HOLDLOCK) WHERE site_id=@site_id AND drive_id=@drive_id AND folder_path=@folder_path AND is_active=1)
        INSERT INTO DecisionMatrixDocumentLocations (location_id, site_id, drive_id, folder_path, label, added_by)
        VALUES (@location_id, @site_id, @drive_id, @folder_path, 'SOP folder', @added_by);
      COMMIT TRANSACTION;
      SELECT location_id, site_id, drive_id, folder_path FROM DecisionMatrixDocumentLocations
        WHERE site_id=@site_id AND drive_id=@drive_id AND folder_path=@folder_path AND is_active=1;`);
  return result.recordset[0];
}

async function knownDocuments(pool: sql.ConnectionPool, locationId: string): Promise<KnownDocument[]> {
  const result = await pool.request().input("location_id", sql.NVarChar, locationId)
    .query<{ item_id: string; etag: string | null; disappeared_at: Date | null }>("SELECT item_id,etag,disappeared_at FROM DecisionMatrixLocationDocuments WHERE location_id=@location_id");
  return result.recordset.map((row) => ({ item_id: row.item_id, etag: row.etag, disappeared: row.disappeared_at !== null }));
}

async function upsert(pool: sql.ConnectionPool, locationId: string, document: ObservedDocument): Promise<void> {
  await pool.request()
    .input("location_id", sql.NVarChar, locationId)
    .input("item_id", sql.NVarChar, document.item_id)
    .input("name", sql.NVarChar, document.name)
    .input("relative_path", sql.NVarChar, document.relative_path)
    .input("mime_type", sql.NVarChar, document.mime_type)
    .input("size_bytes", sql.BigInt, document.size_bytes)
    .input("etag", sql.NVarChar, document.etag)
    .input("last_modified_at", sql.DateTime2, document.last_modified_at ? new Date(document.last_modified_at) : null)
    .query(`
      MERGE DecisionMatrixLocationDocuments WITH (HOLDLOCK) AS target
      USING (SELECT @location_id location_id, @item_id item_id) AS source
        ON target.location_id=source.location_id AND target.item_id=source.item_id
      WHEN MATCHED THEN UPDATE SET
        name=@name, relative_path=@relative_path, mime_type=@mime_type, size_bytes=@size_bytes,
        etag=@etag, last_modified_at=@last_modified_at, last_seen_at=SYSUTCDATETIME(),
        -- Seeing it again clears the record of it having gone.
        disappeared_at=NULL
      WHEN NOT MATCHED THEN INSERT (location_id,item_id,name,relative_path,mime_type,size_bytes,etag,last_modified_at)
      VALUES (@location_id,@item_id,@name,@relative_path,@mime_type,@size_bytes,@etag,@last_modified_at);`);
}

async function markDisappeared(pool: sql.ConnectionPool, locationId: string, itemIds: string[]): Promise<void> {
  for (const itemId of itemIds) {
    // Only the first notice sets the date: when it went is a fact about the
    // document, not about the last walk to see it missing.
    await pool.request().input("location_id", sql.NVarChar, locationId).input("item_id", sql.NVarChar, itemId)
      .query("UPDATE DecisionMatrixLocationDocuments SET disappeared_at=SYSUTCDATETIME() WHERE location_id=@location_id AND item_id=@item_id AND disappeared_at IS NULL");
  }
}

async function recordWalk(pool: sql.ConnectionPool, locationId: string, walk: Pick<WalkResult, "outcome" | "reason">): Promise<void> {
  await pool.request()
    .input("location_id", sql.NVarChar, locationId)
    .input("status", sql.NVarChar, syncStatusFor(walk))
    .input("reason", sql.NVarChar, walk.reason?.slice(0, 400) ?? null)
    .query("UPDATE DecisionMatrixDocumentLocations SET last_synced_at=SYSUTCDATETIME(), last_sync_status=@status, last_sync_reason=@reason WHERE location_id=@location_id");
}

export interface WalkRecorded {
  added: number;
  changed: number;
  returned: number;
  disappeared: number;
  unchanged: number;
}

/**
 * Record one walk of the SOP folder. What a partial walk saw is still
 * recorded; only a complete walk marks anything gone (reconcile() returns no
 * disappearances otherwise), so one forbidden subfolder cannot make the folder
 * look emptied.
 */
export async function recordSopFolderWalk(pool: sql.ConnectionPool, location: SopLocation, walk: WalkResult): Promise<WalkRecorded> {
  const changes = reconcile(await knownDocuments(pool, location.location_id), walk);
  for (const document of [...changes.added, ...changes.changed, ...changes.returned]) await upsert(pool, location.location_id, document);
  await markDisappeared(pool, location.location_id, changes.disappeared);
  await recordWalk(pool, location.location_id, walk);
  return { added: changes.added.length, changed: changes.changed.length, returned: changes.returned.length, disappeared: changes.disappeared.length, unchanged: changes.unchanged };
}

/** A walk that threw before it could say what it saw. Nothing is concluded from it. */
export async function recordSopFolderWalkFailure(pool: sql.ConnectionPool, location: SopLocation, reason: string): Promise<void> {
  await recordWalk(pool, location.location_id, { outcome: "failed", reason });
}

export interface UnreferencedSop {
  item_id: string;
  name: string;
  /** The folder it sits in, relative to the library root; "" is the root. */
  folder: string;
  /** Its path relative to the library root, as the picker reports one. */
  path: string;
  etag: string | null;
  mime_type: string | null;
  first_seen_at: string;
  last_modified_at: string | null;
}

export type SopWalkStatus = "not_configured" | "not_connected" | "not_walked" | "ok" | "forbidden" | "not_found" | "failed";

export interface UnreferencedSopReport {
  walk: {
    status: SopWalkStatus;
    reason: string | null;
    /** The SOP folder the report is about; null when none is configured. */
    folder: string | null;
    walked_at: string | null;
    overdue: boolean;
  };
  documents: UnreferencedSop[];
}

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

/**
 * The report for the configured library and SOP folder. Only a location that
 * matches the current settings is reported: after the setting changes, the
 * old folder's record is not passed off as the new one's.
 */
export async function unreferencedSopReport(
  pool: sql.ConnectionPool,
  library: { site_id: string; drive_id: string } | null,
  setting: SopFolderSetting,
  /** Why the walk cannot run here (no library, no credential), or null when it can. */
  walkBlocked: string | null,
  now: Date = new Date(),
): Promise<UnreferencedSopReport> {
  if (!library) return { walk: { status: "not_configured", reason: walkBlocked, folder: null, walked_at: null, overdue: false }, documents: [] };
  if (!setting.configured) return { walk: { status: "not_configured", reason: setting.reason, folder: null, walked_at: null, overdue: false }, documents: [] };
  const folder = setting.folder_path;
  for (const surface of [DECISION_MATRIX_SURFACES.governance, DECISION_MATRIX_SURFACES.sopFolder]) {
    if (!(await surfaceReady(pool, surface))) {
      return { walk: { status: "not_connected", reason: `This environment's database is missing the tables from migration ${surface.migration}.`, folder, walked_at: null, overdue: false }, documents: [] };
    }
  }

  const located = await pool.request()
    .input("site_id", sql.NVarChar, library.site_id).input("drive_id", sql.NVarChar, library.drive_id).input("folder_path", sql.NVarChar, folder)
    .query<{ location_id: string; last_synced_at: Date | null; last_sync_status: SopWalkStatus | null; last_sync_reason: string | null }>(
      "SELECT location_id,last_synced_at,last_sync_status,last_sync_reason FROM DecisionMatrixDocumentLocations WHERE site_id=@site_id AND drive_id=@drive_id AND folder_path=@folder_path AND is_active=1");
  const location = located.recordset[0];
  if (!location?.last_synced_at || !location.last_sync_status) {
    // Never walked because it cannot be, which "runs every morning" would hide.
    if (walkBlocked) return { walk: { status: "not_configured", reason: walkBlocked, folder, walked_at: null, overdue: false }, documents: [] };
    return { walk: { status: "not_walked", reason: "The SOP folder has not been walked yet. The walk runs every morning.", folder, walked_at: null, overdue: false }, documents: [] };
  }

  // Referenced means some Supporting Document Reference on a current revision
  // names the same item in the same drive. A document only a Superseded or
  // Retired revision used has lost its Procedure. The site id is left out of
  // the match: hand-typed references wrote it in more than one form, and an
  // item id is unique within its drive.
  const documents = await pool.request()
    .input("location_id", sql.NVarChar, location.location_id).input("drive_id", sql.NVarChar, library.drive_id)
    .query<{ item_id: string; name: string; relative_path: string; etag: string | null; mime_type: string | null; first_seen_at: Date; last_modified_at: Date | null }>(`
      SELECT d.item_id,d.name,d.relative_path,d.etag,d.mime_type,d.first_seen_at,d.last_modified_at
      FROM DecisionMatrixLocationDocuments d
      WHERE d.location_id=@location_id AND d.disappeared_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ProcedureDocumentReferences r
          JOIN ProcedureRevisions v ON v.procedure_id=r.procedure_id AND v.revision=r.revision
          WHERE r.drive_id=@drive_id AND r.item_id=d.item_id AND v.lifecycle_state IN ('Draft','Under review','Approved'))
      ORDER BY d.first_seen_at DESC, d.name`);

  const walkedAt = location.last_synced_at;
  return {
    walk: {
      status: location.last_sync_status,
      reason: location.last_sync_reason,
      folder,
      walked_at: walkedAt.toISOString(),
      overdue: now.getTime() - walkedAt.getTime() > SOP_WALK_OVERDUE_HOURS * 3600_000,
    },
    documents: documents.recordset.map((row) => {
      const inFolder = joinPath(folder, row.relative_path);
      return {
        item_id: row.item_id,
        name: row.name,
        folder: inFolder,
        path: joinPath(inFolder, row.name),
        etag: row.etag,
        mime_type: row.mime_type,
        first_seen_at: row.first_seen_at.toISOString(),
        last_modified_at: row.last_modified_at ? row.last_modified_at.toISOString() : null,
      };
    }),
  };
}
