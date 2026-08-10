import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

app.http("eventMonitoringHealth", { route: "event-monitoring-health", methods: ["GET"], authLevel: "anonymous", handler: async (req: HttpRequest, context: InvocationContext) => {
  const auth = requireRole(req, STAFF_READ_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  try {
    const pool = await getPool();
    const components = (await pool.request().query("SELECT component,status,last_attempt_at,last_success_at,last_error,detail,updated_at FROM EventModuleHealth ORDER BY component")).recordset;
    const maintenance = (await pool.request().query("SELECT TOP 1 * FROM EventTelemetryMaintenance WHERE id=1")).recordset[0] ?? null;
    const counts = (await pool.request().query<{ history_count: number; diagnostic_count: number; pending_notifications: number }>(`
      SELECT (SELECT COUNT_BIG(*) FROM EventVehiclePositionHistory WHERE report_timestamp >= DATEADD(DAY,-90,SYSUTCDATETIME())) history_count,
             (SELECT COUNT_BIG(*) FROM EventTelemetryDiagnostics WHERE recorded_at >= DATEADD(DAY,-90,SYSUTCDATETIME())) diagnostic_count,
             (SELECT COUNT_BIG(*) FROM EventGeofenceNotifications WHERE status='pending') pending_notifications
    `)).recordset[0];
    return { status: 200, jsonBody: { components, maintenance, counts } };
  } catch (error) {
    context.error("GET /event-monitoring-health failed:", error);
    return { status: 500, jsonBody: { error: "Unable to load Event Monitoring health" } };
  }
} });
