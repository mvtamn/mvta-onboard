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
    if (eventId) request.input("event", sql.UniqueIdentifier, eventId);
    const crossings = (await request.query(`
      SELECT TOP 200 c.*, g.name geofence_name, p.event_id, p.id service_plan_id
      FROM EventGeofenceCrossings c
      JOIN EventGeofences g ON g.id=c.geofence_id
      OUTER APPLY (SELECT TOP 1 p.event_id, p.id FROM EventServicePlanGeofences pg JOIN EventServicePlans p ON p.id=pg.service_plan_id WHERE pg.geofence_id=c.geofence_id ${eventId ? "AND p.event_id=@event" : ""} ORDER BY p.updated_at DESC) p
      ${eventId ? "WHERE p.event_id=@event" : ""}
      ORDER BY c.crossed_at DESC`)).recordset;
    return { status: 200, jsonBody: { crossings } };
  },
});
