import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES, STAFF_READ_ROLES } from "../lib/auth";

app.http("eventGeofences", { route: "event-geofences", methods: ["GET", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, req.method === "GET" ? [...STAFF_READ_ROLES, "OCC.Compliance"] : ADMIN_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool();
  if (req.method === "GET") {
    const rows = (await pool.request().query("SELECT g.* FROM EventGeofences g WHERE g.is_active=1 ORDER BY g.name")).recordset;
    const rules = (await pool.request().query("SELECT * FROM EventGeofenceDirectionRules ORDER BY geofence_id, sort_order")).recordset;
    return { status: 200, jsonBody: { geofences: rows.map((g) => ({ ...g, rules: rules.filter((r) => r.geofence_id === g.id) })) } };
  }
  const b = await req.json() as Record<string, unknown>; if (typeof b.name !== "string" || typeof b.polygon !== "string") return { status: 400, jsonBody: { error: "name and GeoJSON polygon are required" } };
  try { JSON.parse(b.polygon); } catch { return { status: 400, jsonBody: { error: "polygon must be valid GeoJSON" } }
  }
  const r = pool.request(); r.input("name", sql.NVarChar, b.name); r.input("polygon", sql.NVarChar, b.polygon); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system"); return { status: 201, jsonBody: (await r.query("INSERT INTO EventGeofences(name,polygon,updated_by) OUTPUT INSERTED.* VALUES(@name,@polygon,@by)")).recordset[0] };
} });

app.http("eventGeofenceUpdate", { route: "event-geofences/{id}", methods: ["PATCH"], authLevel: "anonymous", handler: async (req) => {
  const auth = requireRole(req, ADMIN_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } }; const b = await req.json() as Record<string, unknown>; const r = (await getPool()).request();
  r.input("id", sql.UniqueIdentifier, req.params.id); r.input("name", sql.NVarChar, b.name); r.input("polygon", sql.NVarChar, b.polygon); r.input("is_active", sql.Bit, b.is_active ?? true); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system"); const out = await r.query("UPDATE EventGeofences SET name=@name,polygon=@polygon,is_active=@is_active,updated_by=@by,updated_at=SYSUTCDATETIME() OUTPUT INSERTED.* WHERE id=@id"); return out.recordset.length ? { status: 200, jsonBody: out.recordset[0] } : { status: 404, jsonBody: { error: "Geofence not found" } };
} });

app.http("eventGeofenceRules", { route: "event-geofences/{id}/rules", methods: ["POST"], authLevel: "anonymous", handler: async (req) => {
  const auth = requireRole(req, ADMIN_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } }; const b = await req.json() as Record<string, unknown>; const r = (await getPool()).request();
  r.input("geofence_id", sql.UniqueIdentifier, req.params.id); r.input("transition", sql.NVarChar, b.transition); r.input("min", sql.Float, Number(b.heading_min)); r.input("max", sql.Float, Number(b.heading_max)); r.input("label", sql.NVarChar, b.destination_label); r.input("location", sql.UniqueIdentifier, b.destination_location_id ?? null); r.input("mode", sql.NVarChar, b.send_mode ?? "manual"); r.input("sort", sql.Int, Number(b.sort_order ?? 0)); return { status: 201, jsonBody: (await r.query("INSERT INTO EventGeofenceDirectionRules(geofence_id,transition,heading_min,heading_max,destination_label,destination_location_id,send_mode,sort_order) OUTPUT INSERTED.* VALUES(@geofence_id,@transition,@min,@max,@label,@location,@mode,@sort)")).recordset[0] };
} });
