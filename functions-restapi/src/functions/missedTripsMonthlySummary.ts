// GET /missed-trips-monthly-summary - the aggregate view behind Missed
// Trips' Monthly Assessments page. Buckets source-verified rows by the
// agency-local service_date month x route x detection_type x review outcome.
// Legacy rows are deliberately excluded: they were produced before the
// timezone/evidence correction and cannot be presented as compliance facts.
// The console pivots this
// into a per-route/month table client-side rather than the backend
// pre-shaping one specific table layout, same "return the facts, let the
// UI decide presentation" approach as otpMonthlyTrend.ts.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

interface MissedTripsSummaryRow {
  service_month: string;
  route_id: string;
  detection_type: string | null;
  validation_status: string;
  trip_count: number;
}

app.http("missedTripsMonthlySummary", {
  route: "missed-trips-monthly-summary",
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
        SELECT CASE WHEN OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { summary: [] } };
      }

      const result = await pool.request().query<MissedTripsSummaryRow>(`
        SELECT
          LEFT(service_date, 6) AS service_month,
          route_id,
          detection_type,
          validation_status,
          COUNT(*) AS trip_count
        FROM MonitoredMissedTrips
        WHERE data_quality_status = 'source_verified'
        GROUP BY LEFT(service_date, 6), route_id, detection_type, validation_status
        ORDER BY service_month DESC, route_id
      `);
      return { status: 200, jsonBody: { summary: result.recordset } };
    } catch (err) {
      context.error("GET /missed-trips-monthly-summary failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
