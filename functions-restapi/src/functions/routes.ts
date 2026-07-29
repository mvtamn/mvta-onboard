// GET /routes - the authoritative MVTA route registry (GtfsRoutes, migration
// 010), backing Compose's affected-routes multi-select so staff pick from
// real route numbers instead of hand-typing free text. Any staff role can
// read; this is reference data only, no write path (writes come from the
// daily gtfsStopsSync timer).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

interface RouteRow {
  route_id: string;
  route_short_name: string | null;
  route_long_name: string | null;
  route_sort_order: number | null;
}

app.http("routesList", {
  route: "routes",
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
        SELECT CASE WHEN OBJECT_ID('dbo.GtfsRoutes', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { routes: [] } };
      }

      const result = await pool.request().query<RouteRow>(`
        SELECT route_id, route_short_name, route_long_name, route_sort_order
        FROM GtfsRoutes
        ORDER BY route_sort_order, route_short_name
      `);
      return { status: 200, jsonBody: { routes: result.recordset } };
    } catch (err) {
      context.error("GET /routes failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
