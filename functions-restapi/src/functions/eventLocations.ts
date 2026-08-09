import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES, STAFF_READ_ROLES } from "../lib/auth";

app.http("eventLocations", { route: "event-locations", methods: ["GET", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest, context: InvocationContext) => {
  const auth = requireRole(req, req.method === "GET" ? [...STAFF_READ_ROLES, "OCC.Compliance"] : ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  try {
    const pool = await getPool();
    if (req.method === "GET") return { status: 200, jsonBody: { locations: (await pool.request().query("SELECT * FROM EventLocations WHERE is_active = 1 ORDER BY name")).recordset } };
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.name !== "string" || typeof body.category !== "string" || !Number.isFinite(Number(body.latitude)) || !Number.isFinite(Number(body.longitude))) return { status: 400, jsonBody: { error: "name, category, latitude, and longitude are required" } };
    const r = pool.request(); r.input("name", sql.NVarChar, body.name); r.input("category", sql.NVarChar, body.category); r.input("latitude", sql.Float, Number(body.latitude)); r.input("longitude", sql.Float, Number(body.longitude)); r.input("notes", sql.NVarChar, body.notes ?? null); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    return { status: 201, jsonBody: (await r.query("INSERT INTO EventLocations(name,category,latitude,longitude,notes,updated_by) OUTPUT INSERTED.* VALUES(@name,@category,@latitude,@longitude,@notes,@by)")).recordset[0] };
  } catch (err) { context.error("event-locations failed", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
} });

app.http("eventLocationUpdate", { route: "event-locations/{id}", methods: ["PATCH"], authLevel: "anonymous", handler: async (req, context) => {
  const auth = requireRole(req, ADMIN_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const body = await req.json() as Record<string, unknown>; const r = (await getPool()).request();
  r.input("id", sql.UniqueIdentifier, req.params.id); r.input("name", sql.NVarChar, body.name); r.input("category", sql.NVarChar, body.category); r.input("latitude", sql.Float, Number(body.latitude)); r.input("longitude", sql.Float, Number(body.longitude)); r.input("notes", sql.NVarChar, body.notes ?? null); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
  try { const out = await r.query("UPDATE EventLocations SET name=@name,category=@category,latitude=@latitude,longitude=@longitude,notes=@notes,updated_by=@by,updated_at=SYSUTCDATETIME() OUTPUT INSERTED.* WHERE id=@id"); return out.recordset.length ? { status: 200, jsonBody: out.recordset[0] } : { status: 404, jsonBody: { error: "Location not found" } }; } catch (err) { context.error("event-location update failed", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
} });
