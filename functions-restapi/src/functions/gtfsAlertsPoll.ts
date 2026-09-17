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
import { runFeedIngestion } from "../lib/feedRun";
import { mapAlertEntity } from "../lib/gtfsRealtime";
import { fetchGtfsRtFeed, gtfsRtFeedUrl, gtfsRtUrlSetting } from "../lib/gtfsRtReader";

app.timer("gtfsAlertsPoll", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = gtfsRtFeedUrl("alerts");
    if (!feedUrl) {
      context.warn(`${gtfsRtUrlSetting("alerts")} is not configured - skipping this run.`);
      return;
    }

    // Ledgered so a broken alert feed no longer looks exactly like a quiet one.
    // No KPI declares it, so it informs the Admin page without gating a stream.
    await runFeedIngestion("gtfs_alerts", context, async () => {
      const feed = await fetchGtfsRtFeed("alerts", feedUrl);

      const pool = await getPool();
      let insertedCount = 0;
      // An alert already in the queue is handled, not lost: the dedup below
      // declines it on purpose. Only a throw counts against the delivery.
      let handledCount = 0;

      for (const entity of feed.Entities) {
        let mapped;
        try {
          mapped = mapAlertEntity(entity);
        } catch (err) {
          context.error(`Failed to map GTFS-RT alert entity ${entity.Id}:`, err);
          continue;
        }
        if (!mapped) {
          // Nothing in this entity to queue; not a loss.
          handledCount++;
          continue;
        }

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
          handledCount++;
        } catch (err) {
          context.error(`Failed to insert GTFS-RT alert ${mapped.external_id}:`, err);
        }
      }

      context.log(
        `GTFS-RT Alert poll: ${feed.Entities.length} entities seen, ${insertedCount} new suggested alerts inserted.`,
      );
      return { kind: "stored", received: feed.Entities.length, stored: handledCount, noun: "alert entities" };
    });
  },
});
