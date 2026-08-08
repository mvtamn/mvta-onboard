// GET /missed-trips/reviews - append-only review history for one candidate.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

app.http("missedTripReviewsList", {
  route: "missed-trips/reviews",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const tripId = request.query.get("trip_id")?.trim();
    const serviceDate = request.query.get("service_date")?.trim();
    if (!tripId || !serviceDate) {
      return { status: 400, jsonBody: { error: "trip_id and service_date are required" } };
    }
    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.MissedTripReviewHistory', 'U') IS NULL THEN 0 ELSE 1 END AS ready
      `);
      if (tableCheck.recordset[0]?.ready !== 1) return { status: 200, jsonBody: { reviews: [] } };
      const req = pool.request();
      req.input("trip_id", sql.NVarChar, tripId);
      req.input("service_date", sql.NVarChar, serviceDate);
      const result = await req.query(`
        SELECT review_id, previous_validation_status, validation_status, reason_code,
               notes, reviewed_by, reviewed_at
        FROM MissedTripReviewHistory
        WHERE trip_id = @trip_id AND service_date = @service_date
        ORDER BY reviewed_at DESC, review_id DESC
      `);
      return { status: 200, jsonBody: { reviews: result.recordset } };
    } catch (err) {
      context.error("GET /missed-trips/reviews failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
