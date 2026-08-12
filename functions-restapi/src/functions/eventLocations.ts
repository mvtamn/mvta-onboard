import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES, STAFF_READ_ROLES } from "../lib/auth";
import { canonicalLocationKey } from "../lib/eventLocationIdentity";

app.http("eventLocations", { route: "event-locations", methods: ["GET", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest, context: InvocationContext) => {
  const auth = requireRole(req, req.method === "GET" ? [...STAFF_READ_ROLES, "OCC.Compliance"] : ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  try {
    const pool = await getPool();
    if (req.method === "GET") return { status: 200, jsonBody: { locations: (await pool.request().query("SELECT id,name,category,latitude,longitude,notes,is_active,updated_by,updated_at FROM (SELECT l.*,ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))),LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at,id) duplicate_rank FROM EventLocations l WHERE is_active=1) canonical WHERE duplicate_rank=1 ORDER BY name")).recordset } };
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.name !== "string" || typeof body.category !== "string" || !Number.isFinite(Number(body.latitude)) || !Number.isFinite(Number(body.longitude))) return { status: 400, jsonBody: { error: "name, category, latitude, and longitude are required" } };
    const name = body.name.trim();
    const category = body.category.trim();
    const existing = (await pool.request().query("SELECT id,name,category FROM EventLocations WHERE is_active=1")).recordset.find((row) => canonicalLocationKey(row.name, row.category) === canonicalLocationKey(name, category));
    if (existing) return { status: 409, jsonBody: { error: `An active location already exists for ${existing.name}.`, location_id: existing.id } };
    const r = pool.request(); r.input("name", sql.NVarChar, name); r.input("category", sql.NVarChar, category); r.input("latitude", sql.Float, Number(body.latitude)); r.input("longitude", sql.Float, Number(body.longitude)); r.input("notes", sql.NVarChar, body.notes ?? null); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    return { status: 201, jsonBody: (await r.query("INSERT INTO EventLocations(name,category,latitude,longitude,notes,updated_by) OUTPUT INSERTED.* VALUES(@name,@category,@latitude,@longitude,@notes,@by)")).recordset[0] };
  } catch (err) { context.error("event-locations failed", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
} });

app.http("eventLocationUpdate", { route: "event-locations/{id}", methods: ["PATCH"], authLevel: "anonymous", handler: async (req, context) => {
  const auth = requireRole(req, ADMIN_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  try {
    const body = await req.json() as Record<string, unknown>; const pool = await getPool();
    const current = (await pool.request().input("id", sql.UniqueIdentifier, req.params.id).query("SELECT TOP 1 * FROM EventLocations WHERE id=@id")).recordset[0] as Record<string, unknown> | undefined;
    if (!current) return { status: 404, jsonBody: { error: "Location not found" } };
    const name = body.name === undefined ? current.name : body.name;
    const category = body.category === undefined ? current.category : body.category;
    const latitude = body.latitude === undefined ? current.latitude : Number(body.latitude);
    const longitude = body.longitude === undefined ? current.longitude : Number(body.longitude);
    const notes = body.notes === undefined ? current.notes : body.notes;
    const isActive = body.is_active === undefined ? current.is_active : body.is_active;
    if (typeof name !== "string" || !name.trim() || typeof category !== "string" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || typeof isActive !== "boolean") return { status: 400, jsonBody: { error: "Invalid location update" } };
    const r = pool.request(); r.input("id", sql.UniqueIdentifier, req.params.id); r.input("name", sql.NVarChar, name.trim()); r.input("category", sql.NVarChar, category); r.input("latitude", sql.Float, latitude); r.input("longitude", sql.Float, longitude); r.input("notes", sql.NVarChar, notes ?? null); r.input("is_active", sql.Bit, isActive); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    const out = await r.query("UPDATE EventLocations SET name=@name,category=@category,latitude=@latitude,longitude=@longitude,notes=@notes,is_active=@is_active,updated_by=@by,updated_at=SYSUTCDATETIME() OUTPUT INSERTED.* WHERE id=@id");
    return { status: 200, jsonBody: out.recordset[0] };
  } catch (err) { context.error("event-location update failed", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
} });
