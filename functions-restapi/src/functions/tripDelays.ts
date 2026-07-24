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
        SELECT trip_id, route_id, vehicle_id, next_stop_id, delay_seconds,
               polls_over_threshold, first_seen_at, last_polled_at, suggested_alert_id,
               latitude, longitude, bearing, speed_mps, occupancy_status,
               current_status, position_updated_at
        FROM MonitoredTripDelays
        ORDER BY delay_seconds DESC
      `);
      return { status: 200, jsonBody: { delays: result.recordset } };
    } catch (err) {
      context.error("GET /trip-delays failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
