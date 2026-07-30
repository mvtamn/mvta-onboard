// GET /avail-avl - the latest known position for every vehicle reporting
// through Avail's proprietary AVL Reports API, backing the console's Event
// Monitoring view. Any staff role can read; this is visibility only - all
// writes come from availAvlPoll.ts.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

interface AvailAvlRow {
  vehicle_id: number;
  route: number | null;
  block: number | null;
  run: number | null;
  trip: number | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  direction: string | null;
  report_timestamp: Date;
  updated_at: Date;
}

app.http("availAvlList", {
  route: "avail-avl",
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
        SELECT CASE WHEN OBJECT_ID('dbo.AvailAvlVehiclePositions', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      const configured = Boolean(
        process.env.AVAIL_AVL_REPORTS_URL?.trim() && process.env.AVAIL_AVL_REPORTS_API_KEY?.trim(),
      );
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: { vehicles: [], diagnostics: { configured, table_ready: false, vehicle_count: 0, last_report_at: null } },
        };
      }

      const result = await pool.request().query<AvailAvlRow>(`
        SELECT vehicle_id, route, block, run, trip, latitude, longitude, heading, direction,
               report_timestamp, updated_at
        FROM AvailAvlVehiclePositions
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
            configured,
            table_ready: true,
            vehicle_count: vehicles.length,
            last_report_at: lastReportAt?.toISOString() ?? null,
          },
        },
      };
    } catch (err) {
      context.error("GET /avail-avl failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
