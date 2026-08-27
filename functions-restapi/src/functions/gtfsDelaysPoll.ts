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
import { recordFeedHealth } from "../lib/missedTripFeedHealth";
import {
  fetchTripUpdateFeed,
  mapTripUpdateEntity,
  severityForDelayMinutes,
  buildDepartureRiskDraftText,
  type MappedTripDelay,
  type GtfsRtTripUpdateEntity,
} from "../lib/gtfsTripUpdates";
import { agencyServiceDate } from "../lib/missedTripTime";
import { DEPARTURE_RISK_THRESHOLD_SECONDS } from "../lib/tripDelayRisk";

const ESCALATION_POLL_COUNT = 2;
const STALE_AFTER_MINUTES = 15;

interface MergeResult {
  polls_over_threshold: number;
  suggested_alert_id: string | null;
}

function predictionQuality(delay: MappedTripDelay): {
  confidence: "high" | "medium" | "low";
  reasons: string[];
} {
  const reasons: string[] = [];
  const predictionCount = delay.departure_predictions.length;
  const timedPredictions = delay.departure_predictions.filter(
    (prediction) => prediction.predicted_departure_at !== null,
  ).length;

  reasons.push(`${predictionCount} future departure prediction${predictionCount === 1 ? "" : "s"} available.`);
  if (delay.vehicle_id) reasons.push("TripUpdate is linked to an assigned vehicle.");
  else reasons.push("No assigned vehicle is present in the TripUpdate.");
  if (timedPredictions === predictionCount) reasons.push("Every retained prediction includes an absolute departure time.");
  else reasons.push(`${predictionCount - timedPredictions} prediction${predictionCount - timedPredictions === 1 ? "" : "s"} use delay only.`);

  const confidence =
    predictionCount >= 3 && !!delay.vehicle_id && timedPredictions >= 2
      ? "high"
      : predictionCount >= 2
        ? "medium"
        : "low";
  return { confidence, reasons };
}

async function upsertDelay(pool: sql.ConnectionPool, delay: MappedTripDelay): Promise<MergeResult> {
  const quality = predictionQuality(delay);
  const request = pool.request();
  request.input("trip_id", sql.NVarChar, delay.trip_id);
  request.input("route_id", sql.NVarChar, delay.route_id);
  request.input("service_date", sql.NVarChar, delay.service_date);
  request.input("vehicle_id", sql.NVarChar, delay.vehicle_id);
  request.input("next_stop_id", sql.NVarChar, delay.next_stop_id);
  request.input("delay_seconds", sql.Int, delay.delay_seconds);
  request.input(
    "predicted_max_departure_delay_seconds",
    sql.Int,
    delay.predicted_max_departure_delay_seconds,
  );
  request.input("first_threshold_stop_id", sql.NVarChar, delay.first_threshold_stop_id);
  request.input(
    "first_threshold_departure_at",
    sql.DateTime2,
    delay.first_threshold_departure_at,
  );
  request.input(
    "departure_predictions",
    sql.NVarChar,
    JSON.stringify(delay.departure_predictions),
  );
  request.input("prediction_confidence", sql.NVarChar, quality.confidence);
  request.input("prediction_reasons", sql.NVarChar, JSON.stringify(quality.reasons));
  const result = await request.query<MergeResult>(`
    MERGE MonitoredTripDelays WITH (HOLDLOCK) AS target
    USING (SELECT @trip_id AS trip_id) AS src
    ON target.trip_id = src.trip_id
    WHEN MATCHED THEN
      UPDATE SET
        route_id = @route_id,
        service_date = @service_date,
        vehicle_id = @vehicle_id,
        previous_stop_id = CASE
          WHEN target.next_stop_id IS NOT NULL AND target.next_stop_id <> @next_stop_id
          THEN target.next_stop_id ELSE target.previous_stop_id END,
        next_stop_id = @next_stop_id,
        delay_seconds = @delay_seconds,
        predicted_max_departure_delay_seconds = @predicted_max_departure_delay_seconds,
        first_threshold_stop_id = @first_threshold_stop_id,
        first_threshold_departure_at = @first_threshold_departure_at,
        departure_predictions = @departure_predictions,
        prediction_confidence = @prediction_confidence,
        prediction_reasons = @prediction_reasons,
        prediction_updated_at = SYSUTCDATETIME(),
        polls_over_threshold = CASE WHEN @predicted_max_departure_delay_seconds > ${DEPARTURE_RISK_THRESHOLD_SECONDS} THEN target.polls_over_threshold + 1 ELSE 0 END,
        last_polled_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (
        trip_id, route_id, service_date, vehicle_id, next_stop_id, delay_seconds,
        predicted_max_departure_delay_seconds, first_threshold_stop_id,
        first_threshold_departure_at, departure_predictions,
        prediction_confidence, prediction_reasons, prediction_updated_at,
        polls_over_threshold, first_seen_at, last_polled_at
      )
      VALUES (
        @trip_id, @route_id, @service_date, @vehicle_id, @next_stop_id, @delay_seconds,
        @predicted_max_departure_delay_seconds, @first_threshold_stop_id,
        @first_threshold_departure_at, @departure_predictions,
        @prediction_confidence, @prediction_reasons, SYSUTCDATETIME(),
        CASE WHEN @predicted_max_departure_delay_seconds > ${DEPARTURE_RISK_THRESHOLD_SECONDS} THEN 1 ELSE 0 END,
        SYSUTCDATETIME(), SYSUTCDATETIME()
      )
    OUTPUT INSERTED.polls_over_threshold, INSERTED.suggested_alert_id;
  `);
  return result.recordset[0];
}

// Logs that a trip_id was seen in the feed today, independent of
// MonitoredTripDelays (which purges rows 15 minutes after a trip goes quiet,
// including ordinary on-time completions - it can't answer "was this trip
// ever observed today" on its own). Guarded the same way GtfsScheduledTrips
// is in gtfsStopsSync.ts, since migration 011 may not be applied yet.
async function recordObservedTrip(
  pool: sql.ConnectionPool,
  tripId: string,
  serviceDate: string | null,
): Promise<void> {
  const request = pool.request();
  request.input("trip_id", sql.NVarChar, tripId);
  request.input("service_date", sql.NVarChar, serviceDate ?? "unknown");
  await request.query(`
    IF NOT EXISTS (
      SELECT 1 FROM GtfsObservedTrips WHERE trip_id = @trip_id AND service_date = @service_date
    )
    INSERT INTO GtfsObservedTrips (trip_id, service_date) VALUES (@trip_id, @service_date)
  `);
}

async function recordTripUpdateEvidence(
  pool: sql.ConnectionPool,
  entity: GtfsRtTripUpdateEntity,
): Promise<boolean> {
  const update = entity.TripUpdate;
  if (!update?.Trip?.TripId) return false;
  const observedAt =
    Number.isFinite(update.Timestamp) && update.Timestamp > 0
      ? new Date(update.Timestamp * 1000)
      : new Date();
  const serviceDate = update.Trip.StartDate || agencyServiceDate(observedAt).serviceDate;
  const req = pool.request();
  req.input("trip_id", sql.NVarChar, update.Trip.TripId);
  req.input("service_date", sql.NVarChar, serviceDate);
  req.input("route_id", sql.NVarChar, update.Trip.RouteId);
  req.input("vehicle_id", sql.NVarChar, update.Vehicle?.Id ?? null);
  req.input("observed_at", sql.DateTime2, observedAt);
  await req.query(`
    MERGE GtfsTripOperationalEvidence WITH (HOLDLOCK) AS target
    USING (SELECT @trip_id AS trip_id, @service_date AS service_date) AS src
    ON target.trip_id = src.trip_id AND target.service_date = src.service_date
    WHEN MATCHED THEN UPDATE SET
      route_id = @route_id,
      vehicle_id = COALESCE(@vehicle_id, target.vehicle_id),
      last_trip_update_at = @observed_at,
      source_timestamp_at = @observed_at,
      updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (
      trip_id, service_date, route_id, vehicle_id,
      first_trip_update_at, last_trip_update_at, source_timestamp_at
    ) VALUES (
      @trip_id, @service_date, @route_id, @vehicle_id,
      @observed_at, @observed_at, @observed_at
    );
  `);
  return true;
}

async function escalateToSuggestedAlert(
  pool: sql.ConnectionPool,
  delay: MappedTripDelay,
  context: InvocationContext,
): Promise<void> {
  let stopName: string | null = null;
  const affectedStopId = delay.first_threshold_stop_id ?? delay.next_stop_id;
  if (affectedStopId) {
    const stopReq = pool.request();
    stopReq.input("stop_id", sql.NVarChar, affectedStopId);
    const stopResult = await stopReq.query<{ stop_name: string }>(
      "SELECT TOP 1 stop_name FROM GtfsStops WHERE stop_id = @stop_id",
    );
    stopName = stopResult.recordset[0]?.stop_name ?? null;
  }

  const delayMinutes = Math.round(delay.predicted_max_departure_delay_seconds / 60);
  const draftText = buildDepartureRiskDraftText(delay.route_id, delayMinutes, stopName);
  const severity = severityForDelayMinutes(delayMinutes);

  const insertReq = pool.request();
  insertReq.input("source", sql.NVarChar, "gtfs_rt");
  insertReq.input(
    "external_id",
    sql.NVarChar,
    `delay:${delay.service_date ?? "unknown"}:${delay.trip_id}`.slice(0, 100),
  );
  insertReq.input("draft_text", sql.NVarChar, draftText);
  insertReq.input("category", sql.NVarChar, "delay");
  insertReq.input("severity", sql.NVarChar, severity);
  insertReq.input("routes_affected", sql.NVarChar, JSON.stringify([delay.route_id]));
  insertReq.input(
    "detail",
    sql.NVarChar,
    JSON.stringify({
      detection_type: "delay",
      service_date: delay.service_date,
      trip_id: delay.trip_id,
      vehicle_id: delay.vehicle_id,
      stop_id: affectedStopId,
      current_departure_delay_seconds: delay.delay_seconds,
      predicted_max_departure_delay_seconds: delay.predicted_max_departure_delay_seconds,
      first_threshold_departure_at: delay.first_threshold_departure_at?.toISOString() ?? null,
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

  context.log(`GTFS-RT departure risk escalated: trip ${delay.trip_id} (route ${delay.route_id}, predicted ${delayMinutes} min) -> suggested alert ${alertId}`);
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
    try {
      await recordFeedHealth(pool, "gtfs_trip_updates", feed.Entities.length, feed.Header?.Timestamp ?? null);
    } catch (err) {
      context.error("Failed to update TripUpdate feed health:", err);
    }
    let escalatedCount = 0;

    const observedTableCheck = await pool.request().query<{ table_exists: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.GtfsObservedTrips', 'U') IS NULL
        THEN 0 ELSE 1 END AS table_exists
    `);
    const observedTableExists = observedTableCheck.recordset[0]?.table_exists === 1;
    const evidenceTableCheck = await pool.request().query<{ table_exists: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NULL
        THEN 0 ELSE 1 END AS table_exists
    `);
    const evidenceTableExists = evidenceTableCheck.recordset[0]?.table_exists === 1;
    let evidenceCount = 0;

    for (const entity of feed.Entities) {
      if (evidenceTableExists) {
        try {
          if (await recordTripUpdateEvidence(pool, entity)) evidenceCount++;
        } catch (err) {
          context.error(`Failed to record TripUpdate evidence for entity ${entity.Id}:`, err);
        }
      }
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
        `GTFS-RT departure risk: route ${mapped.route_id} trip ${mapped.trip_id} current=${mapped.delay_seconds}s predicted_max=${mapped.predicted_max_departure_delay_seconds}s next_stop=${mapped.next_stop_id ?? "?"}`,
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

      if (observedTableExists) {
        try {
          await recordObservedTrip(pool, mapped.trip_id, mapped.service_date);
        } catch (err) {
          context.error(`Failed to record observed trip for ${mapped.trip_id}:`, err);
        }
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
      `GTFS-RT TripUpdate poll: ${feed.Entities.length} entities seen, ${evidenceCount} evidence rows recorded, ` +
        `${escalatedCount} new suggested alerts escalated.`,
    );
    if (!observedTableExists) {
      context.warn(
        "GtfsObservedTrips does not exist yet; apply migration 011 to enable missed-trip detection.",
      );
    }
    if (!evidenceTableExists) {
      context.warn(
        "GtfsTripOperationalEvidence does not exist; apply migration 027 to capture raw missed-trip evidence.",
      );
    }
  },
});
