import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES } from "../lib/auth";

const tableFor = (kind: string) => ({ routes: "EventServicePlanRoutes", geofences: "EventServicePlanGeofences", locations: "EventServicePlanLocations" } as Record<string, string>)[kind];
app.http("eventServicePlans", { route: "event-service-plans", methods: ["GET", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, ADMIN_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } }; const pool = await getPool();
  if (req.method === "GET") return { status: 200, jsonBody: { plans: (await pool.request().query("SELECT * FROM EventServicePlans ORDER BY created_at DESC")).recordset } };
  const b = await req.json() as Record<string, unknown>; if (typeof b.name !== "string" || !b.name.trim()) return { status: 400, jsonBody: { error: "name is required" } }; const r = pool.request(); r.input("name", sql.NVarChar, b.name.trim()); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system"); return { status: 201, jsonBody: (await r.query("INSERT INTO EventServicePlans(name,created_by,updated_by) OUTPUT INSERTED.* VALUES(@name,@by,@by)")).recordset[0] };
} });
app.http("eventServicePlanAction", { route: "event-service-plans/{id}/{action}", methods: ["PATCH", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, ADMIN_ROLES); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } }; const action = req.params.action; const pool = await getPool(); const id = req.params.id;
  if (action === "advance") { const r = pool.request(); r.input("id", sql.UniqueIdentifier, id); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system"); const out = await r.query("UPDATE EventServicePlans SET status='active',updated_by=@by,updated_at=SYSUTCDATETIME() OUTPUT INSERTED.* WHERE id=@id AND status='draft'"); return out.recordset.length ? { status: 200, jsonBody: out.recordset[0] } : { status: 409, jsonBody: { error: "Only draft plans can be activated" } }; }
  const kind = action === "routes" || action === "geofences" || action === "locations" ? action : null; const table = kind && tableFor(kind); if (!table) return { status: 404, jsonBody: { error: "Unknown service-plan action" } }; const b = await req.json() as Record<string, unknown>; const key = kind === "routes" ? "route_id" : kind === "geofences" ? "geofence_id" : "location_id"; const r = pool.request(); r.input("plan", sql.UniqueIdentifier, id); r.input("value", kind === "routes" ? sql.Int : sql.UniqueIdentifier, kind === "routes" ? Number(b[key]) : b[key]); await r.query(`INSERT INTO ${table}(service_plan_id,${key}) VALUES(@plan,@value)`); return { status: 201, jsonBody: { ok: true } };
} });
