// GET /on-demand-risks - active MVTA Connect wait-time risks.
//
// The endpoint is vendor-neutral. A future adapter for the authoritative
// on-demand platform writes current trip state into MonitoredOnDemandWaits;
// this read contract and the OCC UI do not need to change when that adapter is
// implemented. No customer PII is returned.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

interface OnDemandRiskRow {
  trip_id: string;
  external_trip_id: string | null;
  zone_id: string;
  wait_started_at: Date;
  predicted_pickup_at: Date | null;
  current_wait_minutes: number;
  predicted_wait_minutes: number | null;
  assigned_vehicle_id: string | null;
  stops_ahead: number | null;
  accessible_vehicle_required: boolean;
  eligible_vehicles_in_zone: number | null;
  nearest_vehicle_context: string | null;
  trend: "worsening" | "stable" | "recovering";
  prediction_confidence: "high" | "medium" | "low" | null;
  prediction_reasons: string | null;
  source_updated_at: Date | null;
  last_polled_at: Date;
  suggested_alert_id: string | null;
}

app.http("onDemandRisksList", {
  route: "on-demand-risks",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, STAFF_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    try {
      const pool = await getPool();
      const result = await pool.request().query<OnDemandRiskRow>(`
        SELECT TOP 250
          trip_id, external_trip_id, zone_id, wait_started_at,
          predicted_pickup_at, current_wait_minutes, predicted_wait_minutes,
          assigned_vehicle_id, stops_ahead, accessible_vehicle_required,
          eligible_vehicles_in_zone, nearest_vehicle_context, trend,
          prediction_confidence, prediction_reasons, source_updated_at,
          last_polled_at, suggested_alert_id
        FROM MonitoredOnDemandWaits
        WHERE last_polled_at >= DATEADD(MINUTE, -30, SYSUTCDATETIME())
        ORDER BY
          CASE
            WHEN current_wait_minutes > 25 THEN 0
            WHEN predicted_wait_minutes > 25 THEN 1
            WHEN predicted_wait_minutes > 20 THEN 2
            ELSE 3
          END,
          COALESCE(predicted_wait_minutes, current_wait_minutes) DESC
      `);

      const risks = result.recordset.map((row) => ({
        ...row,
        prediction_reasons: row.prediction_reasons
          ? JSON.parse(row.prediction_reasons)
          : [],
      }));
      return { status: 200, jsonBody: { risks } };
    } catch (err) {
      context.error("GET /on-demand-risks failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
