// Timer-triggered ingestion of MVTA's GTFS-Realtime Alert feed into the
// SuggestedAlerts human-review queue.
//
// Alert entries aren't algorithmically detected - they're detour/service-
// change notices a dispatcher already entered into the CAD system. This is a
// bridge, not a detector: it carries that already-human-authored content
// into OnBoard's own review queue so OCC staff can decide whether/how to
// notify riders through OnBoard's channels (SMS/email/app) - a separate
// decision from the original CAD entry, since the two systems aren't
// otherwise connected. HANDOFF §2.3: nothing here auto-publishes to riders;
// a row only becomes a rider-facing Message via the existing
// suggestedAlertsApprove flow in suggestedAlerts.ts.
//
// Dedup: the feed is re-fetched on every run, so entities already inserted
// (by GTFS-RT Entity.Id, tracked in SuggestedAlerts.external_id - see
// migration-004) are skipped via IF NOT EXISTS rather than re-inserted.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchAlertFeed, mapAlertEntity } from "../lib/gtfsRealtime";

app.timer("gtfsAlertsPoll", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.GTFS_RT_ALERT_URL;
    if (!feedUrl) {
      context.warn("GTFS_RT_ALERT_URL is not configured - skipping this run.");
      return;
    }

    let feed;
    try {
      feed = await fetchAlertFeed(feedUrl);
    } catch (err) {
      context.error("Failed to fetch GTFS-RT Alert feed:", err);
      return;
    }

    const pool = await getPool();
    let insertedCount = 0;

    for (const entity of feed.Entities) {
      let mapped;
      try {
        mapped = mapAlertEntity(entity);
      } catch (err) {
        context.error(`Failed to map GTFS-RT alert entity ${entity.Id}:`, err);
        continue;
      }
      if (!mapped) continue;

      try {
        const sqlRequest = pool.request();
        sqlRequest.input("source", sql.NVarChar, "gtfs_rt");
        sqlRequest.input("external_id", sql.NVarChar, mapped.external_id);
        sqlRequest.input("draft_text", sql.NVarChar, mapped.draft_text);
        sqlRequest.input("category", sql.NVarChar, mapped.category);
        sqlRequest.input("severity", sql.NVarChar, mapped.severity);
        sqlRequest.input("routes_affected", sql.NVarChar, JSON.stringify(mapped.routes_affected));
        sqlRequest.input("detail", sql.NVarChar, JSON.stringify(mapped.detail));
        const result = await sqlRequest.query(`
          IF NOT EXISTS (
            SELECT 1 FROM SuggestedAlerts WHERE source = @source AND external_id = @external_id
          )
          INSERT INTO SuggestedAlerts (source, external_id, draft_text, category, severity, routes_affected, detail)
          VALUES (@source, @external_id, @draft_text, @category, @severity, @routes_affected, @detail)
        `);
        if (result.rowsAffected[0] > 0) insertedCount++;
      } catch (err) {
        context.error(`Failed to insert GTFS-RT alert ${mapped.external_id}:`, err);
      }
    }

    context.log(
      `GTFS-RT Alert poll: ${feed.Entities.length} entities seen, ${insertedCount} new suggested alerts inserted.`,
    );
  },
});
