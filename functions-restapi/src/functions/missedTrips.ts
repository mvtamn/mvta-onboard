// GET /missed-trips - the currently-tracked missed-trip candidates (explicit
// cancellations and schedule-based silent no-shows), backing the console's
// Missed Trips view (now under the Compliance tab). Any staff role, plus the
// dedicated OCC.Compliance role, can read; this is visibility only - all
// writes come from gtfsMissedTripsPoll.ts. Mirrors tripDelays.ts's shape.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

interface MissedTripRow {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_departure_at: Date;
  grace_deadline_at: Date;
  status: string;
  detection_type: string | null;
  detected_late_arrival_at: Date | null;
  suggested_alert_id: string | null;
  first_seen_watching_at: Date;
  last_checked_at: Date;
  validation_status: string;
  reason_code: string | null;
  validated_by: string | null;
  validated_at: Date | null;
  notes: string | null;
}

app.http("missedTripsList", {
  route: "missed-trips",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: {
            missed_trips: [],
            diagnostics: { configured: false },
          },
        };
      }

      const result = await pool.request().query<MissedTripRow>(`
        SELECT trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at,
               status, detection_type, detected_late_arrival_at, suggested_alert_id,
               first_seen_watching_at, last_checked_at,
               validation_status, reason_code, validated_by, validated_at, notes
        FROM MonitoredMissedTrips
        ORDER BY
          CASE validation_status WHEN 'unreviewed' THEN 0 ELSE 1 END,
          CASE status WHEN 'escalated' THEN 0 WHEN 'watching' THEN 1 ELSE 2 END,
          scheduled_departure_at DESC
      `);
      const missedTrips = result.recordset;
      const configured = Boolean(
        process.env.GTFS_RT_TRIPUPDATE_URL?.trim() && process.env.GTFS_STATIC_URL?.trim(),
      );
      return {
        status: 200,
        jsonBody: {
          missed_trips: missedTrips,
          diagnostics: {
            configured,
            active_count: missedTrips.filter((t) => t.status !== "resolved").length,
            resolved_count: missedTrips.filter((t) => t.status === "resolved").length,
            unreviewed_count: missedTrips.filter((t) => t.validation_status === "unreviewed").length,
          },
        },
      };
    } catch (err) {
      context.error("GET /missed-trips failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
