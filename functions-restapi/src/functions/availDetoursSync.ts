// Timer-triggered sync of Avail's Detours feed into the Detours/
// DetourSegments tables - Part B4-B5 of detour-and-event-module-
// implementation-plan.md, completing detour-module-build-brief.md's
// "Suggested build order" step 4-5.
//
// Cadence: every 15 minutes, per the brief's own suggested starting point
// ("start with every 15-30 min, adjust once you see how often Avail data
// actually changes").
//
// Upsert key is external_detour_id (Avail's own DetourID) - migration-017
// put source/external_detour_id on Detours from day one specifically so
// this sync never has to create duplicate rows. Never touches a
// source='manual' row (the brief's own explicit rule - those are the
// operator-message/stop-closure entries that will never appear in Avail's
// feed at all, and a naive sync that "cleans up missing rows" would delete
// them).
//
// Part B5 decision (last_edited_manually): if a human has since hand-edited
// a source='avail' row (detoursUpdate.ts stamps this flag), the sync skips
// overwriting closure/dates/segments on that row - the human correction
// wins, every run, indefinitely. It still updates avail_last_seen_at
// (migration-019) so staff can tell the sync is still tracking the detour
// in Avail even though it isn't touching the editable fields.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchDetours, groupDetourReports, type MappedDetour } from "../lib/availDetoursFeed";

interface ExistingDetourRow {
  id: string;
  last_edited_manually: boolean;
}

async function insertSegments(tx: sql.Transaction, detourId: string, segments: MappedDetour["segments"]): Promise<void> {
  for (const [i, seg] of segments.entries()) {
    const segReq = new sql.Request(tx);
    segReq.input("detour_id", sql.UniqueIdentifier, detourId);
    segReq.input("routes", sql.NVarChar, seg.routes);
    segReq.input("directions", sql.NVarChar, seg.directions);
    segReq.input("sort_order", sql.Int, i);
    await segReq.query(`
      INSERT INTO DetourSegments (detour_id, routes, directions, sort_order)
      VALUES (@detour_id, @routes, @directions, @sort_order)
    `);
  }
}

app.timer("availDetoursSync", {
  schedule: "0 */15 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const baseUrl = process.env.AVAIL_DETOURS_URL;
    const apiKey = process.env.AVAIL_AVL_REPORTS_API_KEY;
    if (!baseUrl || !apiKey) {
      context.warn("AVAIL_DETOURS_URL/AVAIL_AVL_REPORTS_API_KEY are not configured - skipping this run.");
      return;
    }

    let reports;
    try {
      reports = await fetchDetours(baseUrl, apiKey);
    } catch (err) {
      context.error("Failed to fetch Avail Detours:", err);
      return;
    }

    const grouped = groupDetourReports(reports);
    const pool = await getPool();

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const detour of grouped) {
      const lookupReq = new sql.Request(pool);
      lookupReq.input("external_detour_id", sql.NVarChar, detour.external_detour_id);
      let existing: ExistingDetourRow | undefined;
      try {
        const existingResult = await lookupReq.query<ExistingDetourRow>(`
          SELECT id, last_edited_manually
          FROM Detours
          WHERE external_detour_id = @external_detour_id AND source = 'avail' AND is_deleted = 0
        `);
        existing = existingResult.recordset[0];
      } catch (err) {
        context.error(`Failed to look up Avail detour ${detour.external_detour_id}:`, err);
        continue;
      }

      const tx = new sql.Transaction(pool);
      try {
        await tx.begin();

        if (!existing) {
          const insertReq = new sql.Request(tx);
          insertReq.input("closure", sql.NVarChar, detour.closure);
          insertReq.input("start_date", sql.Date, detour.start_date);
          insertReq.input("end_date", sql.Date, detour.end_date);
          insertReq.input("external_detour_id", sql.NVarChar, detour.external_detour_id);
          insertReq.input("created_by", sql.NVarChar, "avail-sync");
          const insertResult = await insertReq.query<{ id: string }>(`
            INSERT INTO Detours (
              closure, start_date, end_date, source, external_detour_id,
              created_by, avail_last_seen_at
            )
            OUTPUT INSERTED.id
            VALUES (
              @closure, @start_date, @end_date, 'avail', @external_detour_id,
              @created_by, SYSUTCDATETIME()
            )
          `);
          await insertSegments(tx, insertResult.recordset[0].id, detour.segments);
          await tx.commit();
          inserted += 1;
          continue;
        }

        if (existing.last_edited_manually) {
          // Preserve the human correction - only bump the freshness marker.
          const touchReq = new sql.Request(tx);
          touchReq.input("id", sql.UniqueIdentifier, existing.id);
          await touchReq.query("UPDATE Detours SET avail_last_seen_at = SYSUTCDATETIME() WHERE id = @id");
          await tx.commit();
          skipped += 1;
          continue;
        }

        const updateReq = new sql.Request(tx);
        updateReq.input("id", sql.UniqueIdentifier, existing.id);
        updateReq.input("closure", sql.NVarChar, detour.closure);
        updateReq.input("start_date", sql.Date, detour.start_date);
        updateReq.input("end_date", sql.Date, detour.end_date);
        await updateReq.query(`
          UPDATE Detours
          SET closure = @closure, start_date = @start_date, end_date = @end_date,
              avail_last_seen_at = SYSUTCDATETIME()
          WHERE id = @id
        `);

        const deleteSegReq = new sql.Request(tx);
        deleteSegReq.input("detour_id", sql.UniqueIdentifier, existing.id);
        await deleteSegReq.query("DELETE FROM DetourSegments WHERE detour_id = @detour_id");
        await insertSegments(tx, existing.id, detour.segments);

        await tx.commit();
        updated += 1;
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          /* already rolled back / not begun */
        }
        context.error(`Failed to sync Avail detour ${detour.external_detour_id}:`, err);
      }
    }

    context.log(
      `Avail Detours sync: ${grouped.length} detours seen, ${inserted} inserted, ${updated} updated, ${skipped} skipped (manually edited).`,
    );
  },
});
