import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { EVENT_AVL_NOTIFICATION_ROLES, STAFF_READ_ROLES, requireRole } from "../lib/auth";
import { isGuid } from "../lib/validation";
import { polygonContains } from "../lib/geofence";

const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 1440;

async function listTests() {
  const pool = await getPool();
  const tests = (await pool.request().query(`
    SELECT t.id,t.location_id,l.name location_name,t.geofence_id,g.name geofence_name,t.is_enabled,t.expires_at,t.created_by,t.created_at,t.updated_by,t.updated_at,
      latest.status last_message_status,latest.exited_at last_message_at
    FROM EventDepotDepartureTests t
    JOIN EventLocations l ON l.id=t.location_id JOIN EventGeofences g ON g.id=t.geofence_id
    OUTER APPLY (SELECT TOP 1 status,exited_at FROM EventDepotDepartureTestMessages m WHERE m.test_id=t.id ORDER BY m.created_at DESC) latest
    ORDER BY t.is_enabled DESC,t.expires_at DESC,t.created_at DESC
  `)).recordset;
  return { tests, teams_configured: Boolean(process.env.TEAMS_EVENT_WEBHOOK_URL), teams_destination: process.env.TEAMS_EVENT_CHANNEL_NAME ?? "Configured Teams channel" };
}

app.http("depotDepartureTests", { route: "depot-departure-tests", methods: ["GET", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, req.method === "GET" ? STAFF_READ_ROLES : EVENT_AVL_NOTIFICATION_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  if (req.method === "GET") return { status: 200, jsonBody: await listTests() };
  if (!process.env.TEAMS_EVENT_WEBHOOK_URL) return { status: 409, jsonBody: { error: "Teams webhook is not configured" } };
  let body: { location_id?: unknown; geofence_id?: unknown; duration_minutes?: unknown };
  try { body = await req.json() as typeof body; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
  const locationId = typeof body.location_id === "string" ? body.location_id : "";
  const geofenceId = typeof body.geofence_id === "string" ? body.geofence_id : "";
  const durationMinutes = typeof body.duration_minutes === "number" ? body.duration_minutes : Number(body.duration_minutes);
  if (!isGuid(locationId) || !isGuid(geofenceId) || !Number.isInteger(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) return { status: 400, jsonBody: { error: `location_id and geofence_id must be valid GUIDs; duration_minutes must be ${MIN_DURATION_MINUTES}–${MAX_DURATION_MINUTES}` } };
  const pool = await getPool();
  const pair = (await pool.request().input("location", sql.UniqueIdentifier, locationId).input("geofence", sql.UniqueIdentifier, geofenceId).query<{ latitude: number; longitude: number; polygon: string }>(`
    SELECT l.latitude,l.longitude,g.polygon FROM EventLocations l CROSS JOIN EventGeofences g
    WHERE l.id=@location AND l.is_active=1 AND g.id=@geofence AND g.is_active=1
  `)).recordset[0];
  if (!pair) return { status: 400, jsonBody: { error: "Select an active reference location and Monitoring Area" } };
  try { if (!polygonContains(pair.polygon, [pair.longitude, pair.latitude])) return { status: 400, jsonBody: { error: "The reference location must be inside the selected Monitoring Area" } }; }
  catch { return { status: 400, jsonBody: { error: "The selected Monitoring Area has invalid geometry" } }; }
  const actor = auth.principal.userDetails ?? "system";
  const request = pool.request(); request.input("location", sql.UniqueIdentifier, locationId); request.input("geofence", sql.UniqueIdentifier, geofenceId); request.input("minutes", sql.Int, durationMinutes); request.input("actor", sql.NVarChar, actor);
  const test = (await request.query<{ id: string }>(`
    MERGE EventDepotDepartureTests WITH (HOLDLOCK) AS target
    USING (SELECT @location location_id,@geofence geofence_id) source ON target.location_id=source.location_id AND target.geofence_id=source.geofence_id
    WHEN MATCHED THEN UPDATE SET is_enabled=1,expires_at=DATEADD(MINUTE,@minutes,SYSUTCDATETIME()),updated_by=@actor,updated_at=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT(location_id,geofence_id,is_enabled,expires_at,created_by,updated_by) VALUES(@location,@geofence,1,DATEADD(MINUTE,@minutes,SYSUTCDATETIME()),@actor,@actor)
    OUTPUT INSERTED.id;
  `)).recordset[0];
  await pool.request().input("test", sql.UniqueIdentifier, test.id).query("DELETE FROM EventDepotDepartureTestVehicleState WHERE test_id=@test");
  return { status: 201, jsonBody: (await listTests()) };
} });

app.http("depotDepartureTestDisable", { route: "depot-departure-tests/{id}", methods: ["DELETE"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, EVENT_AVL_NOTIFICATION_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  if (!isGuid(req.params.id)) return { status: 400, jsonBody: { error: "Test id must be a valid GUID" } };
  const pool = await getPool(); const request = pool.request(); request.input("id", sql.UniqueIdentifier, req.params.id); request.input("actor", sql.NVarChar, auth.principal.userDetails ?? "system");
  const result = await request.query("UPDATE EventDepotDepartureTests SET is_enabled=0,updated_by=@actor,updated_at=SYSUTCDATETIME() WHERE id=@id AND is_enabled=1");
  return result.rowsAffected[0] ? { status: 204 } : { status: 404, jsonBody: { error: "Active depot departure test not found" } };
} });
