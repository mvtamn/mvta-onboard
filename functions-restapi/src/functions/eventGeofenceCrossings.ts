import { app, type HttpRequest } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

app.http("eventGeofenceCrossings", {
  route: "event-geofence-crossings", methods: ["GET"], authLevel: "anonymous",
  handler: async (req: HttpRequest) => {
    const auth = requireRole(req, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const pool = await getPool();
    const crossings = (await pool.request().query("SELECT TOP 200 c.*, g.name geofence_name FROM EventGeofenceCrossings c JOIN EventGeofences g ON g.id=c.geofence_id ORDER BY c.crossed_at DESC")).recordset;
    return { status: 200, jsonBody: { crossings } };
  },
});
