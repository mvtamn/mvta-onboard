// Daily purge of detour images for detours that have been over for a
// while - the owner's decision was "purge one year after expiry" as a privacy default
// (phone photos of a road closure can incidentally include license plates
// or bystanders), with a grace window long enough for a dispute/QA look-
// back. Only detours with a real end_date are ever purged - open-ended/
// monitor-only detours (no end_date) keep their images indefinitely, since
// they're not "expired" by this table's own definition (see
// detourStatus.ts). Deletes the blob first, then the DetourImages row -
// if the blob delete fails, the row is left in place so the next run
// retries rather than losing track of an orphaned blob.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { deleteBlob, BlobStorageNotConfiguredError } from "../lib/blobStorage";

// Long enough for a dispute/QA look-back after a detour ends, short enough
// to satisfy the privacy concern that motivated purging at all. Tunable.
const IMAGE_RETENTION_GRACE_DAYS = 365;

interface PurgeCandidate {
  id: string;
  blob_path: string;
}

app.timer("detourImagesPurge", {
  schedule: "0 0 8 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const pool = await getPool();

    const tableCheck = await pool.request().query<{ table_exists: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.DetourImages', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
    `);
    if (tableCheck.recordset[0]?.table_exists !== 1) {
      context.warn("DetourImages does not exist yet - skipping this run.");
      return;
    }

    const req = pool.request();
    req.input("grace_days", sql.Int, IMAGE_RETENTION_GRACE_DAYS);
    const candidates = await req.query<PurgeCandidate>(`
      SELECT i.id, i.blob_path
      FROM DetourImages i
      JOIN Detours d ON d.id = i.detour_id
      WHERE d.end_date IS NOT NULL
        AND DATEADD(DAY, @grace_days, d.end_date) < CAST(SYSUTCDATETIME() AS DATE)
    `);

    let deletedCount = 0;
    let skippedNotConfigured = false;
    for (const img of candidates.recordset) {
      try {
        await deleteBlob(img.blob_path);
      } catch (err) {
        if (err instanceof BlobStorageNotConfiguredError) {
          skippedNotConfigured = true;
          break; // no point trying the rest this run
        }
        context.error(`Failed to delete blob for image ${img.id} (${img.blob_path}):`, err);
        continue; // leave the row in place, retry next run
      }
      try {
        const deleteReq = pool.request();
        deleteReq.input("id", sql.UniqueIdentifier, img.id);
        await deleteReq.query("DELETE FROM DetourImages WHERE id = @id");
        deletedCount++;
      } catch (err) {
        context.error(`Blob deleted but failed to remove DetourImages row ${img.id}:`, err);
      }
    }

    if (skippedNotConfigured) {
      context.warn("DETOUR_IMAGES_STORAGE_ACCOUNT is not configured - skipping this run.");
      return;
    }
    context.log(`Detour images purge: ${candidates.recordset.length} candidates, ${deletedCount} deleted.`);
  },
});
