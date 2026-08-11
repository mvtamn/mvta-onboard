import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

app.http("eventMonitoringHealth", { route: "event-monitoring-health", methods: ["GET"], authLevel: "anonymous", handler: async (req: HttpRequest, context: InvocationContext) => {
  const auth = requireRole(req, STAFF_READ_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  try {
    const pool = await getPool();
    const eventId = req.query.get("event_id");
    const components = (await pool.request().query("SELECT component,status,last_attempt_at,last_success_at,last_error,detail,updated_at FROM EventModuleHealth ORDER BY component")).recordset;
    const maintenance = (await pool.request().query("SELECT TOP 1 * FROM EventTelemetryMaintenance WHERE id=1")).recordset[0] ?? null;
    const countRequest = pool.request(); if (eventId) countRequest.input("event", sql.UniqueIdentifier, eventId);
    const counts = (await countRequest.query<{ history_count: number; diagnostic_count: number; pending_notifications: number; active_vehicle_count: number; diagnostic_vehicle_count: number; pending_assignment_count: number; crossing_count: number }>(`
      SELECT (SELECT COUNT_BIG(*) FROM EventVehiclePositionHistory WHERE report_timestamp >= DATEADD(DAY,-90,SYSUTCDATETIME())) history_count,
             (SELECT COUNT_BIG(*) FROM EventTelemetryDiagnostics WHERE recorded_at >= DATEADD(DAY,-90,SYSUTCDATETIME())) diagnostic_count,
             (SELECT COUNT_BIG(*) FROM EventGeofenceNotifications n ${eventId ? "WHERE n.status='pending' AND EXISTS (SELECT 1 FROM EventGeofenceCrossings c JOIN EventServicePlanGeofences pg ON pg.geofence_id=c.geofence_id JOIN EventServicePlans p ON p.id=pg.service_plan_id WHERE c.id=n.crossing_id AND p.event_id=@event)" : "WHERE n.status='pending'"}) pending_notifications,
             (SELECT COUNT_BIG(*) FROM EventVehicleCurrentPosition v ${eventId ? "WHERE EXISTS (SELECT 1 FROM EventServicePlanRoutes pr JOIN EventServicePlans p ON p.id=pr.service_plan_id WHERE pr.route_id=v.route AND p.event_id=@event AND p.status='active')" : ""}) active_vehicle_count,
             (SELECT COUNT_BIG(*) FROM EventVehicleCurrentPosition v ${eventId ? "WHERE NOT EXISTS (SELECT 1 FROM EventServicePlanRoutes pr JOIN EventServicePlans p ON p.id=pr.service_plan_id WHERE pr.route_id=v.route AND p.event_id=@event AND p.status='active')" : ""}) diagnostic_vehicle_count,
             (SELECT COUNT_BIG(*) FROM EventVehicleAssignments a WHERE a.status='proposed' ${eventId ? "AND a.event_id=@event" : ""}) pending_assignment_count,
             (SELECT COUNT_BIG(*) FROM EventGeofenceCrossings c ${eventId ? "WHERE EXISTS (SELECT 1 FROM EventServicePlanGeofences pg JOIN EventServicePlans p ON p.id=pg.service_plan_id WHERE pg.geofence_id=c.geofence_id AND p.event_id=@event)" : ""}) crossing_count
    `)).recordset[0];
    return { status: 200, jsonBody: { event_id: eventId, components, maintenance, counts } };
  } catch (error) {
    context.error("GET /event-monitoring-health failed:", error);
    return { status: 500, jsonBody: { error: "Unable to load Event Monitoring health" } };
  }
} });
