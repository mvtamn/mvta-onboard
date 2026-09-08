// GET /on-demand-risks - active MVTA Connect wait-time risks.
//
// MonitoredOnDemandWaits still stores the legacy trip_id/external_trip_id
// column names; this contract speaks the canonical vocabulary (an on-demand
// passenger request, never a trip) and aliases them at the query boundary.
//
// The endpoint is vendor-neutral. A future adapter for the authoritative
// on-demand platform writes current trip state into MonitoredOnDemandWaits;
// this read contract and the OCC UI do not need to change when that adapter is
// implemented. No customer PII is returned.
//
// It returns risks, not every monitored request. The workspace heads this list
// "Immediate attention - Wait-time exceptions" and its empty state promises
// nothing "inside the watch band or above its applicable standard", so a
// request that is neither has no business in it. WITHIN_STANDARD_PREDICATE
// below is the exact complement of the console's `waitState` "Within standard"
// branch (OnDemandServiceQuality.tsx); the two are hand-synced, the same
// convention this repo already uses for types mirrored between functions-restapi
// and frontend/shared. How many requests are being watched is a separate fact,
// answered by diagnostics.monitored_request_count.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { PUBLISH_ROLES, requireRole, STAFF_READ_ROLES } from "../lib/auth";
import {
  ON_DEMAND_DEGRADED_AFTER_MINUTES,
  ON_DEMAND_RECONCILIATION_INTERVAL_MINUTES,
  onDemandMonitoringEnabled,
  onDemandMonitoringState,
} from "../lib/onDemandMonitoringHealth";

// A predicted wait above this, with nothing observed yet, is a Watch: worth
// showing before it breaches. Above the applicable standard it is a risk
// outright, and the standard is per-zone, so both bounds are needed.
const WATCH_PREDICTED_MINUTES = 20;
// At or beyond standard + this margin a wait is Critical rather than merely
// over. It only affects ordering here; the console applies the same margin to
// its label.
const CRITICAL_MARGIN_MINUTES = 15;

// Excluded from the result. Read it as: the pickup commitment has not passed,
// the forecast is inside the watch band, and the request is in a zone we can
// judge. A NULL zone_resolution predates zone tracking and is judged on its
// numbers, exactly as the console does.
const WITHIN_STANDARD_PREDICATE = `
  (m.zone_resolution IS NULL OR m.zone_resolution = 'assigned')
  AND w.current_wait_minutes = 0
  AND e.effective_predicted_minutes <= @watch_minutes
  AND e.effective_predicted_minutes <= s.service_standard_minutes
`;

// Active, and fresh enough to be a current claim. Shared by the risk query and
// the monitored count so the two can never describe different populations.
const MONITORED_PREDICATE = `
  m.monitor_state = 'active'
  AND (@show_last_known = 1 OR @reconciled_at IS NULL OR m.last_polled_at >= @reconciled_at)
`;

// Exported so onDemandRisks.db.contract.test.ts runs this exact statement
// against a real SQL Server. A test that restates the query proves only that
// the restatement is consistent with itself.
export const ON_DEMAND_RISK_QUERY = `
        SELECT TOP 250
          m.trip_id AS request_id, m.external_trip_id AS external_request_id, m.zone_id, m.wait_started_at,
          m.predicted_pickup_at,
          w.current_wait_minutes, w.predicted_wait_minutes,
          m.assigned_vehicle_id, m.stops_ahead, m.accessible_vehicle_required,
          m.eligible_vehicles_in_zone, m.nearest_vehicle_context, m.trend,
          m.prediction_confidence, m.prediction_reasons, m.source_updated_at,
          m.last_polled_at, m.suggested_alert_id, m.monitor_state, m.zone_resolution,
          i.status AS intervention_status,
          s.service_standard_minutes
        FROM MonitoredOnDemandWaits m
        -- Computed once and named, so the risk test, the ordering and the
        -- projection all read the same numbers. They used to be repeated as
        -- raw DATEDIFF/COALESCE expressions in each place.
        CROSS APPLY (SELECT
          CASE WHEN m.wait_started_at < SYSUTCDATETIME()
            THEN DATEDIFF(MINUTE, m.wait_started_at, SYSUTCDATETIME()) ELSE 0 END AS current_wait_minutes,
          CASE WHEN m.predicted_pickup_at IS NULL THEN NULL
            WHEN m.predicted_pickup_at > m.wait_started_at
              THEN DATEDIFF(MINUTE, m.wait_started_at, m.predicted_pickup_at) ELSE 0 END AS predicted_wait_minutes
        ) w
        LEFT JOIN (
          SELECT z.external_location_id
          FROM dbo.OnDemandOperationalZones z
          JOIN dbo.OnDemandOperationalZoneVersions v ON v.id = z.zone_version_id AND v.is_active = 1
        ) z ON z.external_location_id = m.zone_id
        LEFT JOIN dbo.OnDemandServiceStandardPolicy p ON p.id = 1
        LEFT JOIN dbo.OnDemandZoneServiceStandardOverrides o ON o.external_location_id = z.external_location_id
          AND o.revoked_at IS NULL AND o.effective_at <= SYSUTCDATETIME() AND SYSUTCDATETIME() < o.expires_at
        LEFT JOIN dbo.OnDemandServiceQualityInterventions i ON i.request_id = m.trip_id
        CROSS APPLY (SELECT COALESCE(o.minutes, p.default_minutes, 25) AS service_standard_minutes) s
        -- A missing forecast is not an optimistic one: it falls back to what
        -- has already been observed, the same substitution the console makes.
        CROSS APPLY (SELECT COALESCE(w.predicted_wait_minutes, w.current_wait_minutes) AS effective_predicted_minutes) e
        WHERE ${MONITORED_PREDICATE}
          AND NOT (${WITHIN_STANDARD_PREDICATE})
        ORDER BY
          CASE
            -- An unzoned or untracked request cannot be judged against a
            -- standard at all, so it sorts below every request that can be.
            WHEN m.zone_resolution IS NOT NULL AND m.zone_resolution <> 'assigned' THEN 5
            WHEN w.current_wait_minutes >= s.service_standard_minutes + @critical_margin
              OR e.effective_predicted_minutes >= s.service_standard_minutes + @critical_margin THEN 0
            WHEN w.current_wait_minutes > s.service_standard_minutes THEN 1
            WHEN e.effective_predicted_minutes > s.service_standard_minutes THEN 2
            -- Observed outranks forecast: a passed pickup commitment is a fact.
            WHEN w.current_wait_minutes > 0 THEN 3
            ELSE 4
          END,
          COALESCE(m.predicted_pickup_at, SYSUTCDATETIME()) DESC
      `;

export const MONITORED_COUNT_QUERY = `
  SELECT COUNT(*) AS monitored_request_count FROM MonitoredOnDemandWaits m WHERE ${MONITORED_PREDICATE}
`;

interface OnDemandRiskRow {
  request_id: string;
  external_request_id: string | null;
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
  intervention_status: "open" | "resolved" | null;
  service_standard_minutes: number;
  monitor_state: "active" | "completed" | "cancelled";
  zone_resolution: "assigned" | "missing_pickup_coordinate" | "outside_operational_zones" | "ambiguous_operational_zones" | "legacy_unknown";
}

interface OnDemandHealthRow {
  last_authoritative_reconciliation_at: Date | null;
  latest_source_update_at: Date | null;
  active_request_count: number | null;
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
      const healthResult = await pool.request().query<OnDemandHealthRow>(`
        IF OBJECT_ID('dbo.OnDemandMonitoringHealth', 'U') IS NULL
          SELECT CAST(NULL AS DATETIME2) AS last_authoritative_reconciliation_at,
            CAST(NULL AS DATETIME2) AS latest_source_update_at,
            CAST(NULL AS INT) AS active_request_count;
        ELSE
          SELECT last_authoritative_reconciliation_at, latest_source_update_at, active_request_count
          FROM dbo.OnDemandMonitoringHealth WHERE id = 1;
      `);
      const enabled = onDemandMonitoringEnabled();
      const health = healthResult.recordset[0] ?? null;
      const state = onDemandMonitoringState(enabled, health && {
        lastAuthoritativeReconciliationAt: health.last_authoritative_reconciliation_at,
        latestSourceUpdateAt: health.latest_source_update_at,
        activeRequestCount: health.active_request_count,
      });
      const riskQuery = pool.request();
      riskQuery.input("show_last_known", sql.Bit, state === "degraded");
      riskQuery.input("reconciled_at", sql.DateTime2, health?.last_authoritative_reconciliation_at ?? null);
      riskQuery.input("watch_minutes", sql.Int, WATCH_PREDICTED_MINUTES);
      riskQuery.input("critical_margin", sql.Int, CRITICAL_MARGIN_MINUTES);
      const result = await riskQuery.query<OnDemandRiskRow>(ON_DEMAND_RISK_QUERY);

      // The population the list was drawn from. Without it, "3 trips" in a
      // workspace headed Immediate attention cannot be told apart from a quiet
      // service day and a nearly-broken one.
      const monitoredQuery = pool.request();
      monitoredQuery.input("show_last_known", sql.Bit, state === "degraded");
      monitoredQuery.input("reconciled_at", sql.DateTime2, health?.last_authoritative_reconciliation_at ?? null);
      const monitored = await monitoredQuery.query<{ monitored_request_count: number }>(MONITORED_COUNT_QUERY);

      const risks = result.recordset.map((row) => ({
        ...row,
        prediction_reasons: row.prediction_reasons
          ? JSON.parse(row.prediction_reasons)
          : [],
      }));
      return {
        status: 200,
        jsonBody: {
          risks: enabled ? risks : [],
          diagnostics: {
            state,
            last_authoritative_reconciliation_at: health?.last_authoritative_reconciliation_at?.toISOString() ?? null,
            latest_source_update_at: health?.latest_source_update_at?.toISOString() ?? null,
            active_request_count: enabled ? health?.active_request_count ?? null : null,
            monitored_request_count: enabled ? monitored.recordset[0]?.monitored_request_count ?? 0 : null,
            reconciliation_interval_minutes: ON_DEMAND_RECONCILIATION_INTERVAL_MINUTES,
            degraded_after_minutes: ON_DEMAND_DEGRADED_AFTER_MINUTES,
          },
        },
      };
    } catch (err) {
      context.error("GET /on-demand-risks failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("onDemandInterventionResolve", {
  route: "on-demand-risks/{requestId}/resolve",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, PUBLISH_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const requestId = request.params.requestId?.trim();
    if (!requestId || requestId.length > 100) {
      return { status: 400, jsonBody: { error: "requestId is required and must be at most 100 characters." } };
    }
    let reason: string | null = null;
    try {
      const body = await request.json() as { reason?: unknown };
      reason = typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : null;
    } catch {
      // An empty request body is valid for an operator acknowledgement.
    }
    try {
      const update = (await getPool()).request();
      update.input("request_id", requestId);
      update.input("resolved_by", authResult.principal.userDetails ?? "onboard-console");
      update.input("reason", reason ?? "Resolved by OCC operator.");
      const result = await update.query<{ request_id: string }>(`
        UPDATE dbo.OnDemandServiceQualityInterventions
        SET status = 'resolved', resolved_at = SYSUTCDATETIME(), resolved_by = @resolved_by,
          resolution_reason = @reason, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.request_id
        WHERE request_id = @request_id AND status = 'open';
      `);
      if (!result.recordset[0]) return { status: 404, jsonBody: { error: "No open intervention was found for this request." } };
      return { status: 200, jsonBody: { request_id: requestId, status: "resolved" } };
    } catch (err) {
      context.error("POST /on-demand-risks/{requestId}/resolve failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
