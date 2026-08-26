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
  service_standard_minutes: number;
  monitor_state: "active" | "completed" | "cancelled";
  zone_resolution: "assigned" | "missing_pickup_coordinate" | "outside_operational_zones" | "ambiguous_operational_zones" | "legacy_unknown";
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
          m.trip_id, m.external_trip_id, m.zone_id, m.wait_started_at,
          m.predicted_pickup_at,
          CASE WHEN m.wait_started_at < SYSUTCDATETIME() THEN DATEDIFF(MINUTE, m.wait_started_at, SYSUTCDATETIME()) ELSE 0 END AS current_wait_minutes,
          CASE WHEN m.predicted_pickup_at IS NULL THEN NULL WHEN m.predicted_pickup_at > m.wait_started_at THEN DATEDIFF(MINUTE, m.wait_started_at, m.predicted_pickup_at) ELSE 0 END AS predicted_wait_minutes,
          m.assigned_vehicle_id, m.stops_ahead, m.accessible_vehicle_required,
          m.eligible_vehicles_in_zone, m.nearest_vehicle_context, m.trend,
          m.prediction_confidence, m.prediction_reasons, m.source_updated_at,
          m.last_polled_at, m.suggested_alert_id, m.monitor_state, m.zone_resolution,
          COALESCE(o.minutes, p.default_minutes, 25) AS service_standard_minutes
        FROM MonitoredOnDemandWaits m
        LEFT JOIN (
          SELECT z.external_location_id
          FROM dbo.OnDemandOperationalZones z
          JOIN dbo.OnDemandOperationalZoneVersions v ON v.id = z.zone_version_id AND v.is_active = 1
        ) z ON z.external_location_id = m.zone_id
        LEFT JOIN dbo.OnDemandServiceStandardPolicy p ON p.id = 1
        LEFT JOIN dbo.OnDemandZoneServiceStandardOverrides o ON o.external_location_id = z.external_location_id
          AND o.revoked_at IS NULL AND o.effective_at <= SYSUTCDATETIME() AND SYSUTCDATETIME() < o.expires_at
        WHERE m.monitor_state = 'active' AND m.last_polled_at >= DATEADD(HOUR, -2, SYSUTCDATETIME())
        ORDER BY
          CASE
            WHEN DATEDIFF(MINUTE, m.wait_started_at, SYSUTCDATETIME()) > COALESCE(o.minutes, p.default_minutes, 25) THEN 0
            WHEN m.predicted_pickup_at > DATEADD(MINUTE, COALESCE(o.minutes, p.default_minutes, 25), m.wait_started_at) THEN 1
            WHEN m.predicted_pickup_at > DATEADD(MINUTE, COALESCE(o.minutes, p.default_minutes, 25) - 5, m.wait_started_at) THEN 2
            ELSE 3
          END,
          COALESCE(m.predicted_pickup_at, SYSUTCDATETIME()) DESC
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
