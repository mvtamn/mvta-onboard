import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

app.http("eventModuleAuditStream", { route: "event-module-audit-stream", methods: ["GET"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, [...STAFF_READ_ROLES, "OCC.Compliance"]); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool(); const r = pool.request(); r.input("from", sql.DateTime2, req.query.get("from") ? new Date(req.query.get("from")!) : new Date(Date.now() - 7 * 86400000)); r.input("to", sql.DateTime2, req.query.get("to") ? new Date(req.query.get("to")!) : new Date());
  const result = await r.query(`
    SELECT 'route_classification' event_type, CAST(route_id AS NVARCHAR(100)) entity_id, route_category detail, updated_by actor, updated_at event_at FROM RouteClassification WHERE updated_at BETWEEN @from AND @to
    UNION ALL SELECT 'service_plan' event_type, CAST(id AS NVARCHAR(100)) entity_id, status detail, updated_by actor, updated_at event_at FROM EventServicePlans WHERE updated_at BETWEEN @from AND @to
    UNION ALL SELECT 'service_plan_revision' event_type, CAST(id AS NVARCHAR(100)) entity_id, status detail, updated_by actor, updated_at event_at FROM EventServicePlanRevisions WHERE updated_at BETWEEN @from AND @to
    UNION ALL SELECT 'geofence_crossing', CAST(id AS NVARCHAR(100)), transition + ' ' + CAST(vehicle_id AS NVARCHAR(30)), NULL, crossed_at FROM EventGeofenceCrossings WHERE crossed_at BETWEEN @from AND @to
    UNION ALL SELECT 'notification', CAST(id AS NVARCHAR(100)), status, sent_by, COALESCE(sent_at, created_at) FROM EventGeofenceNotifications WHERE COALESCE(sent_at, created_at) BETWEEN @from AND @to
    ORDER BY event_at DESC`);
  return { status: 200, jsonBody: { entries: result.recordset } };
} });
