// GET /trip-delays - the currently-monitored trips and their live delay,
// backing the console's Live Delays view. Any staff role can read; this is
// visibility only, no write path (writes come from gtfsDelaysPoll.ts).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

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
               d.delay_seconds, d.polls_over_threshold, d.first_seen_at, d.last_polled_at,
               d.suggested_alert_id, d.latitude, d.longitude, d.bearing, d.speed_mps,
               d.occupancy_status, d.current_status, d.position_updated_at
        FROM MonitoredTripDelays d
        LEFT JOIN GtfsStops s ON s.stop_id = d.next_stop_id
        LEFT JOIN GtfsStops ps ON ps.stop_id = d.previous_stop_id
        LEFT JOIN GtfsTripDirections td ON td.trip_id = d.trip_id
        ORDER BY d.route_id, d.delay_seconds DESC
      `);
      return { status: 200, jsonBody: { delays: result.recordset } };
    } catch (err) {
      context.error("GET /trip-delays failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
