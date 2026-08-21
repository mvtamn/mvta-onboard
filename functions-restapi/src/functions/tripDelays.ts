// GET /trip-delays - the currently-monitored trips and their live delay,
// backing the console's Live Delays view. Any staff role can read; this is
// visibility only, no write path (writes come from gtfsDelaysPoll.ts).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import {
  determineTripDelayState,
  TRIP_DELAY_STALE_AFTER_MINUTES,
} from "../lib/tripDelayDiagnostics";
import {
  DEPARTURE_RISK_THRESHOLD_SECONDS,
  isDepartureAtRisk,
} from "../lib/tripDelayRisk";

interface TripDelayRow {
  trip_id: string;
  route_id: string;
  vehicle_id: string | null;
  next_stop_id: string | null;
  next_stop_name: string | null;
  previous_stop_id: string | null;
  previous_stop_name: string | null;
  direction_label: string | null;
  delay_seconds: number;
  service_date: string | null;
  predicted_max_departure_delay_seconds: number | null;
  first_threshold_stop_id: string | null;
  first_threshold_stop_name: string | null;
  first_threshold_departure_at: Date | null;
  departure_predictions: string | null;
  prediction_confidence: string | null;
  prediction_reasons: string | null;
  prediction_updated_at: Date | null;
  polls_over_threshold: number;
  first_seen_at: Date;
  last_polled_at: Date;
  suggested_alert_id: string | null;
  latitude: number | null;
  longitude: number | null;
  bearing: number | null;
  speed_mps: number | null;
  occupancy_status: number | null;
  current_status: number | null;
  position_updated_at: Date | null;
}

app.http("tripDelaysList", {
  route: "trip-delays",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, STAFF_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const result = await pool.request().query<TripDelayRow>(`
        SELECT d.trip_id, d.route_id, d.vehicle_id, d.next_stop_id, s.stop_name AS next_stop_name,
               d.previous_stop_id, ps.stop_name AS previous_stop_name, td.direction_label,
               d.delay_seconds, d.service_date, d.predicted_max_departure_delay_seconds,
               d.first_threshold_stop_id, fs.stop_name AS first_threshold_stop_name,
               d.first_threshold_departure_at, d.departure_predictions,
               d.prediction_confidence, d.prediction_reasons, d.prediction_updated_at,
               d.polls_over_threshold, d.first_seen_at, d.last_polled_at,
               d.suggested_alert_id, d.latitude, d.longitude, d.bearing, d.speed_mps,
               d.occupancy_status, d.current_status, d.position_updated_at
        FROM MonitoredTripDelays d
        LEFT JOIN GtfsStops s ON s.stop_id = d.next_stop_id
        LEFT JOIN GtfsStops ps ON ps.stop_id = d.previous_stop_id
        LEFT JOIN GtfsStops fs ON fs.stop_id = d.first_threshold_stop_id
        LEFT JOIN GtfsTripDirections td ON td.trip_id = d.trip_id
        ORDER BY
          CASE WHEN COALESCE(d.predicted_max_departure_delay_seconds, d.delay_seconds) > ${DEPARTURE_RISK_THRESHOLD_SECONDS} THEN 0 ELSE 1 END,
          d.predicted_max_departure_delay_seconds DESC,
          d.route_id
      `);
      const delays = result.recordset.map((row) => ({
        ...row,
        departure_predictions: row.departure_predictions
          ? JSON.parse(row.departure_predictions)
          : [],
        prediction_reasons: row.prediction_reasons
          ? JSON.parse(row.prediction_reasons)
          : [],
      }));
      const [stopCountResult, directionCountResult, routeCountResult, stopNamesResult] =
        await Promise.all([
        pool.request().query<{ count: number }>(
          "SELECT COUNT_BIG(*) AS count FROM GtfsStops",
        ),
        pool.request().query<{ count: number }>(
          "SELECT COUNT_BIG(*) AS count FROM GtfsTripDirections",
        ),
        pool.request().query<{ count: number }>(`
          IF OBJECT_ID('dbo.GtfsRoutes', 'U') IS NULL
            SELECT CAST(0 AS BIGINT) AS count
          ELSE
            SELECT COUNT_BIG(*) AS count FROM GtfsRoutes
        `),
        pool.request().query<{ stop_id: string; stop_name: string }>(
          "SELECT stop_id, stop_name FROM GtfsStops",
        ),
      ]);
      const stopNames = new Map(
        stopNamesResult.recordset.map((stop) => [stop.stop_id, stop.stop_name]),
      );
      for (const delay of delays) {
        delay.departure_predictions = delay.departure_predictions.map((prediction: { stop_id: string | null }) => ({
          ...prediction,
          stop_name: prediction.stop_id ? stopNames.get(prediction.stop_id) ?? null : null,
        }));
      }
      const lastTripUpdateAt = result.recordset.reduce<Date | null>(
        (latest, row) =>
          !latest || row.last_polled_at > latest ? row.last_polled_at : latest,
        null,
      );
      const thresholdRiskCount = result.recordset.filter(isDepartureAtRisk).length;
      const tripUpdatesConfigured = Boolean(
        process.env.GTFS_RT_TRIPUPDATE_URL?.trim(),
      );
      const staticStopCount = Number(stopCountResult.recordset[0]?.count ?? 0);
      const directionReferenceCount = Number(
        directionCountResult.recordset[0]?.count ?? 0,
      );
      const diagnostics = {
        state: determineTripDelayState({
          tripUpdatesConfigured,
          activeTripCount: delays.length,
          thresholdRiskCount,
          lastTripUpdateAt,
          staticStopCount,
          directionReferenceCount,
        }),
        trip_updates_configured: tripUpdatesConfigured,
        vehicle_positions_configured: Boolean(
          process.env.GTFS_RT_VEHICLE_URL?.trim(),
        ),
        static_gtfs_configured: Boolean(process.env.GTFS_STATIC_URL?.trim()),
        active_trip_count: delays.length,
        threshold_risk_count: thresholdRiskCount,
        last_trip_update_at: lastTripUpdateAt?.toISOString() ?? null,
        route_reference_count: Number(
          routeCountResult.recordset[0]?.count ?? 0,
        ),
        static_stop_count: staticStopCount,
        direction_reference_count: directionReferenceCount,
        stale_after_minutes: TRIP_DELAY_STALE_AFTER_MINUTES,
      };
      return { status: 200, jsonBody: { delays, diagnostics } };
    } catch (err) {
      context.error("GET /trip-delays failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
