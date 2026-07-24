// Timer-triggered GTFS-Realtime TripUpdate delay detection.
//
// Unlike gtfsAlertsPoll.ts (a bridge for already-human-authored CAD notices),
// this is genuine algorithmic detection: every trip's current delay is
// tracked in MonitoredTripDelays and logged every run - satisfying "all
// delays get reported" regardless of size. Only a delay that stays over 15
// minutes across 2 consecutive 5-minute polls (~10 min sustained) escalates
// into a SuggestedAlerts rider-alert candidate, so a single noisy GPS sample
// can't create a false candidate. HANDOFF §2.3 still applies: nothing here
// auto-publishes to riders - escalated rows go through the same
// suggestedAlertsApprove flow as everything else in that queue.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import {
  fetchTripUpdateFeed,
  mapTripUpdateEntity,
  severityForDelayMinutes,
  buildDelayDraftText,
  type MappedTripDelay,
} from "../lib/gtfsTripUpdates";

const DELAY_THRESHOLD_SECONDS = 15 * 60;
const ESCALATION_POLL_COUNT = 2;
const STALE_AFTER_MINUTES = 15;

interface MergeResult {
  polls_over_threshold: number;
  suggested_alert_id: string | null;
}

async function upsertDelay(pool: sql.ConnectionPool, delay: MappedTripDelay): Promise<MergeResult> {
  const request = pool.request();
  request.input("trip_id", sql.NVarChar, delay.trip_id);
  request.input("route_id", sql.NVarChar, delay.route_id);
  request.input("vehicle_id", sql.NVarChar, delay.vehicle_id);
  request.input("next_stop_id", sql.NVarChar, delay.next_stop_id);
  request.input("delay_seconds", sql.Int, delay.delay_seconds);
  const result = await request.query<MergeResult>(`
    MERGE MonitoredTripDelays WITH (HOLDLOCK) AS target
    USING (SELECT @trip_id AS trip_id) AS src
    ON target.trip_id = src.trip_id
    WHEN MATCHED THEN
      UPDATE SET
        route_id = @route_id,
        vehicle_id = @vehicle_id,
        previous_stop_id = CASE
          WHEN target.next_stop_id IS NOT NULL AND target.next_stop_id <> @next_stop_id
          THEN target.next_stop_id ELSE target.previous_stop_id END,
        next_stop_id = @next_stop_id,
        delay_seconds = @delay_seconds,
        polls_over_threshold = CASE WHEN @delay_seconds > ${DELAY_THRESHOLD_SECONDS} THEN target.polls_over_threshold + 1 ELSE 0 END,
        last_polled_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (trip_id, route_id, vehicle_id, next_stop_id, delay_seconds, polls_over_threshold, first_seen_at, last_polled_at)
      VALUES (@trip_id, @route_id, @vehicle_id, @next_stop_id, @delay_seconds,
              CASE WHEN @delay_seconds > ${DELAY_THRESHOLD_SECONDS} THEN 1 ELSE 0 END, SYSUTCDATETIME(), SYSUTCDATETIME())
    OUTPUT INSERTED.polls_over_threshold, INSERTED.suggested_alert_id;
  `);
  return result.recordset[0];
}

async function escalateToSuggestedAlert(
  pool: sql.ConnectionPool,
  delay: MappedTripDelay,
  context: InvocationContext,
): Promise<void> {
  let stopName: string | null = null;
  if (delay.next_stop_id) {
    const stopReq = pool.request();
    stopReq.input("stop_id", sql.NVarChar, delay.next_stop_id);
    const stopResult = await stopReq.query<{ stop_name: string }>(
      "SELECT TOP 1 stop_name FROM GtfsStops WHERE stop_id = @stop_id",
    );
    stopName = stopResult.recordset[0]?.stop_name ?? null;
  }

  const delayMinutes = Math.round(delay.delay_seconds / 60);
  const draftText = buildDelayDraftText(delay.route_id, delayMinutes, stopName);
  const severity = severityForDelayMinutes(delayMinutes);

  const insertReq = pool.request();
  insertReq.input("source", sql.NVarChar, "gtfs_rt");
  insertReq.input("external_id", sql.NVarChar, delay.trip_id);
  insertReq.input("draft_text", sql.NVarChar, draftText);
  insertReq.input("category", sql.NVarChar, "delay");
  insertReq.input("severity", sql.NVarChar, severity);
  insertReq.input("routes_affected", sql.NVarChar, JSON.stringify([delay.route_id]));
  insertReq.input(
    "detail",
    sql.NVarChar,
    JSON.stringify({
      detection_type: "delay",
      trip_id: delay.trip_id,
      vehicle_id: delay.vehicle_id,
      stop_id: delay.next_stop_id,
      delay_seconds: delay.delay_seconds,
    }),
  );
  const inserted = await insertReq.query<{ alert_id: string }>(`
    INSERT INTO SuggestedAlerts (source, external_id, draft_text, category, severity, routes_affected, detail)
    OUTPUT INSERTED.alert_id
    VALUES (@source, @external_id, @draft_text, @category, @severity, @routes_affected, @detail)
  `);
  const alertId = inserted.recordset[0].alert_id;

  const updateReq = pool.request();
  updateReq.input("trip_id", sql.NVarChar, delay.trip_id);
  updateReq.input("alert_id", sql.UniqueIdentifier, alertId);
  await updateReq.query("UPDATE MonitoredTripDelays SET suggested_alert_id = @alert_id WHERE trip_id = @trip_id");

  context.log(`GTFS-RT delay escalated: trip ${delay.trip_id} (route ${delay.route_id}, ${delayMinutes} min) -> suggested alert ${alertId}`);
}

app.timer("gtfsDelaysPoll", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.GTFS_RT_TRIPUPDATE_URL;
    if (!feedUrl) {
      context.warn("GTFS_RT_TRIPUPDATE_URL is not configured - skipping this run.");
      return;
    }

    let feed;
    try {
      feed = await fetchTripUpdateFeed(feedUrl);
    } catch (err) {
      context.error("Failed to fetch GTFS-RT TripUpdate feed:", err);
      return;
    }

    const pool = await getPool();
    let escalatedCount = 0;

    for (const entity of feed.Entities) {
      let mapped;
      try {
        mapped = mapTripUpdateEntity(entity);
      } catch (err) {
        context.error(`Failed to map GTFS-RT trip update entity ${entity.Id}:`, err);
        continue;
      }
      if (!mapped) continue;

      // "All delays get reported" - logged every run regardless of size,
      // independent of whether this trip ever escalates to a rider alert.
      context.log(
        `GTFS-RT trip delay: route ${mapped.route_id} trip ${mapped.trip_id} delay=${mapped.delay_seconds}s next_stop=${mapped.next_stop_id ?? "?"}`,
      );

      try {
        const merged = await upsertDelay(pool, mapped);
        if (merged.polls_over_threshold >= ESCALATION_POLL_COUNT && !merged.suggested_alert_id) {
          await escalateToSuggestedAlert(pool, mapped, context);
          escalatedCount++;
        }
      } catch (err) {
        context.error(`Failed to process GTFS-RT trip delay for ${mapped.trip_id}:`, err);
      }
    }

    try {
      const cleanupReq = pool.request();
      cleanupReq.input("staleMinutes", sql.Int, STALE_AFTER_MINUTES);
      await cleanupReq.query(
        "DELETE FROM MonitoredTripDelays WHERE last_polled_at < DATEADD(MINUTE, -@staleMinutes, SYSUTCDATETIME())",
      );
    } catch (err) {
      context.error("Failed to clean up stale MonitoredTripDelays rows:", err);
    }

    context.log(
      `GTFS-RT TripUpdate poll: ${feed.Entities.length} entities seen, ${escalatedCount} new suggested alerts escalated.`,
    );
  },
});
