// GET /event-vehicle-positions - the latest known position for every
// vehicle classified as SpecialEvent in RouteClassification, backing the
// console's Event Monitoring view's new "Event bus positions (live)" panel.
// Distinct from GET /avail-avl (every vehicle, unfiltered) - this is the
// subset that matters for the still-unbuilt Special Event Vehicle
// Monitoring module (MVTA_ONBOARD_MANUAL.md §18). Any staff role can read;
// this is visibility only - all writes come from availAvlPoll.ts's
// classification step (Part A2). Correctly returns zero vehicles until a
// real RouteClassification row exists for an active event - expected, not
// a bug.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

interface EventVehiclePositionRow {
  vehicle_id: number;
  route: number | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  report_timestamp: Date;
  updated_at: Date;
}

app.http("eventVehiclePositionsList", {
  route: "event-vehicle-positions",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, STAFF_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.EventVehicleCurrentPosition', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: { vehicles: [], diagnostics: { table_ready: false, vehicle_count: 0, last_report_at: null } },
        };
      }

      const result = await pool.request().query<EventVehiclePositionRow>(`
        SELECT vehicle_id, route, latitude, longitude, heading, report_timestamp, updated_at
        FROM EventVehicleCurrentPosition
        ORDER BY route, vehicle_id
      `);
      const vehicles = result.recordset;
      const lastReportAt = vehicles.reduce<Date | null>(
        (latest, row) => (!latest || row.report_timestamp > latest ? row.report_timestamp : latest),
        null,
      );

      return {
        status: 200,
        jsonBody: {
          vehicles,
          diagnostics: {
            table_ready: true,
            vehicle_count: vehicles.length,
            last_report_at: lastReportAt?.toISOString() ?? null,
          },
        },
      };
    } catch (err) {
      context.error("GET /event-vehicle-positions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
