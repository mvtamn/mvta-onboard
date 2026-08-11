import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

app.http("eventModuleAuditStream", { route: "event-module-audit-stream", methods: ["GET"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, [...STAFF_READ_ROLES, "OCC.Compliance"]); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool(); const r = pool.request(); r.input("from", sql.DateTime2, req.query.get("from") ? new Date(req.query.get("from")!) : new Date(Date.now() - 7 * 86400000)); r.input("to", sql.DateTime2, req.query.get("to") ? new Date(req.query.get("to")!) : new Date());
  const eventId = req.query.get("event_id"); if (eventId) r.input("event", sql.UniqueIdentifier, eventId);
  const result = await r.query(`
    SELECT 'route_classification' event_type, CAST(route_id AS NVARCHAR(100)) entity_id, route_category detail, updated_by actor, updated_at event_at FROM RouteClassification WHERE updated_at BETWEEN @from AND @to ${eventId ? "AND EXISTS (SELECT 1 FROM EventServicePlanRoutes spr JOIN EventServicePlans p ON p.id=spr.service_plan_id WHERE spr.route_id=RouteClassification.route_id AND p.event_id=@event)" : ""}
    UNION ALL SELECT 'event' event_type, CAST(id AS NVARCHAR(100)) entity_id, name detail, updated_by actor, updated_at event_at FROM Events WHERE updated_at BETWEEN @from AND @to ${eventId ? "AND id=@event" : ""}
    UNION ALL SELECT 'service_plan' event_type, CAST(id AS NVARCHAR(100)) entity_id, status detail, updated_by actor, updated_at event_at FROM EventServicePlans WHERE updated_at BETWEEN @from AND @to ${eventId ? "AND event_id=@event" : ""}
    UNION ALL SELECT 'service_plan_revision' event_type, CAST(r.id AS NVARCHAR(100)) entity_id, r.status detail, r.updated_by actor, r.updated_at event_at FROM EventServicePlanRevisions r WHERE r.updated_at BETWEEN @from AND @to ${eventId ? "AND EXISTS (SELECT 1 FROM EventServicePlans p WHERE p.id=r.service_plan_id AND p.event_id=@event)" : ""}
    UNION ALL SELECT 'geofence_crossing', CAST(c.id AS NVARCHAR(100)), c.transition + ' ' + CAST(c.vehicle_id AS NVARCHAR(30)), NULL, c.crossed_at FROM EventGeofenceCrossings c WHERE c.crossed_at BETWEEN @from AND @to ${eventId ? "AND EXISTS (SELECT 1 FROM EventServicePlanGeofences pg JOIN EventServicePlans p ON p.id=pg.service_plan_id WHERE pg.geofence_id=c.geofence_id AND p.event_id=@event)" : ""}
    UNION ALL SELECT 'notification', CAST(n.id AS NVARCHAR(100)), n.status, n.sent_by, COALESCE(n.sent_at, n.created_at) FROM EventGeofenceNotifications n WHERE COALESCE(n.sent_at, n.created_at) BETWEEN @from AND @to ${eventId ? "AND EXISTS (SELECT 1 FROM EventGeofenceCrossings c JOIN EventServicePlanGeofences pg ON pg.geofence_id=c.geofence_id JOIN EventServicePlans p ON p.id=pg.service_plan_id WHERE c.id=n.crossing_id AND p.event_id=@event)" : ""}
    UNION ALL SELECT 'vehicle_assignment', CAST(a.id AS NVARCHAR(100)), a.status, a.reviewed_by, COALESCE(a.reviewed_at, a.requested_at) FROM EventVehicleAssignments a WHERE COALESCE(a.reviewed_at, a.requested_at) BETWEEN @from AND @to ${eventId ? "AND a.event_id=@event" : ""}
    ORDER BY event_at DESC`);
  return { status: 200, jsonBody: { entries: result.recordset } };
} });
