import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

app.http("eventGeofenceCrossings", {
  route: "event-geofence-crossings", methods: ["GET"], authLevel: "anonymous",
  handler: async (req: HttpRequest) => {
    const auth = requireRole(req, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const pool = await getPool();
    const request = pool.request();
    const eventId = req.query.get("event_id");
    const servicePlanId = req.query.get("service_plan_id");
    if (eventId) request.input("event", sql.UniqueIdentifier, eventId);
    if (servicePlanId) request.input("plan", sql.UniqueIdentifier, servicePlanId);
    const crossings = (await request.query(`
      SELECT TOP 200 c.*, rc.route_label, g.name geofence_name, p.event_id, p.id service_plan_id
      FROM EventGeofenceCrossings c
      JOIN EventGeofences g ON g.id=c.geofence_id
      LEFT JOIN RouteClassification rc ON rc.route_id=c.route_id
      OUTER APPLY (SELECT TOP 1 p.event_id, p.id FROM EventServicePlans p LEFT JOIN EventServicePlanGeofences pg ON pg.service_plan_id=p.id WHERE (p.id=c.service_plan_id OR (c.service_plan_id IS NULL AND pg.geofence_id=c.geofence_id)) ${eventId ? "AND p.event_id=@event" : ""} ${servicePlanId ? "AND p.id=@plan" : ""} ORDER BY p.updated_at DESC) p
      ${eventId || servicePlanId ? "WHERE p.id IS NOT NULL" : ""}
      ORDER BY c.crossed_at DESC`)).recordset;
    return { status: 200, jsonBody: { crossings } };
  },
});
