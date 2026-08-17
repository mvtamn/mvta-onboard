import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES, STAFF_READ_ROLES } from "../lib/auth";
import { isGuid } from "../lib/validation";
import { validatePolygon } from "../lib/geofence";
import { validateDirectionRule, type DirectionRule } from "../lib/eventDirectionRules";

const GEOFENCE_PURPOSES = ["staging", "corridor", "venue", "other"] as const;
type GeofencePurpose = (typeof GEOFENCE_PURPOSES)[number];

async function activePlanUsesGeofence(pool: Awaited<ReturnType<typeof getPool>>, geofenceId: string): Promise<boolean> {
  const request = pool.request();
  request.input("geofence", sql.UniqueIdentifier, geofenceId);
  return Boolean((await request.query("SELECT TOP 1 1 found FROM EventServicePlanGeofences spg JOIN EventServicePlans sp ON sp.id=spg.service_plan_id WHERE spg.geofence_id=@geofence AND sp.status='active'")).recordset[0]?.found);
}

async function activeLocation(pool: Awaited<ReturnType<typeof getPool>>, locationId: string): Promise<boolean> {
  const request = pool.request();
  request.input("location", sql.UniqueIdentifier, locationId);
  return Boolean((await request.query("SELECT TOP 1 1 found FROM EventLocations WHERE id=@location AND is_active=1")).recordset[0]?.found);
}

async function readRules(pool: Awaited<ReturnType<typeof getPool>>, geofenceId: string): Promise<DirectionRule[]> {
  const request = pool.request();
  request.input("geofence", sql.UniqueIdentifier, geofenceId);
  return (await request.query<DirectionRule>("SELECT id,geofence_id,transition,heading_min,heading_max,destination_label,destination_location_id,message_type,send_mode,sort_order FROM EventGeofenceDirectionRules WHERE geofence_id=@geofence")).recordset;
}

app.http("eventGeofences", { route: "event-geofences", methods: ["GET", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, req.method === "GET" ? [...STAFF_READ_ROLES, "OCC.Compliance"] : ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool();
  if (req.method === "GET") {
    const rows = (await pool.request().query("SELECT g.* FROM EventGeofences g WHERE g.is_active=1 ORDER BY g.name")).recordset;
    const rules = (await pool.request().query("SELECT * FROM EventGeofenceDirectionRules ORDER BY geofence_id, sort_order")).recordset;
    return { status: 200, jsonBody: { geofences: rows.map((g) => ({ ...g, rules: rules.filter((r) => r.geofence_id === g.id) })) } };
  }
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
  if (typeof body.name !== "string" || typeof body.polygon !== "string") return { status: 400, jsonBody: { error: "name and GeoJSON polygon are required" } };
  const purpose = (body.purpose ?? "other") as string;
  if (!GEOFENCE_PURPOSES.includes(purpose as GeofencePurpose)) return { status: 400, jsonBody: { error: "purpose must be staging, corridor, venue, or other" } };
  const polygonError = validatePolygon(body.polygon);
  if (polygonError) return { status: 400, jsonBody: { error: polygonError } };
  const request = pool.request();
  request.input("name", sql.NVarChar, body.name.trim()); request.input("polygon", sql.NVarChar, body.polygon); request.input("purpose", sql.NVarChar, purpose); request.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
  return { status: 201, jsonBody: (await request.query("INSERT INTO EventGeofences(name,polygon,purpose,updated_by) OUTPUT INSERTED.* VALUES(@name,@polygon,@purpose,@by)")).recordset[0] };
} });

app.http("eventGeofenceRuleUpdate", { route: "event-geofences/{id}/rules/{ruleId}", methods: ["PATCH", "DELETE"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  if (!isGuid(req.params.id) || !isGuid(req.params.ruleId)) return { status: 400, jsonBody: { error: "Geofence and rule ids must be valid GUIDs" } };
  const pool = await getPool(); const request = pool.request();
  request.input("id", sql.UniqueIdentifier, req.params.ruleId); request.input("geofence", sql.UniqueIdentifier, req.params.id);
  const existing = (await request.query<DirectionRule>("SELECT id,geofence_id,transition,heading_min,heading_max,destination_label,destination_location_id,message_type,send_mode,sort_order FROM EventGeofenceDirectionRules WHERE id=@id AND geofence_id=@geofence")).recordset[0];
  if (!existing) return { status: 404, jsonBody: { error: "Rule not found" } };
  if (await activePlanUsesGeofence(pool, req.params.id)) return { status: 409, jsonBody: { error: "Direction rules used by an active Service Plan must be changed through a reviewed revision" } };
  if (req.method === "DELETE") {
    const out = await request.query("DELETE FROM EventGeofenceDirectionRules WHERE id=@id AND geofence_id=@geofence");
    return out.rowsAffected[0] ? { status: 204 } : { status: 404, jsonBody: { error: "Rule not found" } };
  }
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
  const result = validateDirectionRule({ ...body, id: existing.id, geofence_id: existing.geofence_id, message_type: (body.message_type ?? existing.message_type ?? "custom") as DirectionRule["message_type"], send_mode: (body.send_mode ?? existing.send_mode ?? "manual") as DirectionRule["send_mode"], sort_order: Number(body.sort_order ?? existing.sort_order) }, await readRules(pool, req.params.id), existing.id);
  if (!result.ok) return { status: 400, jsonBody: { error: "Validation failed", details: result.errors } };
  if (result.value.destination_location_id && !(await activeLocation(pool, result.value.destination_location_id))) return { status: 400, jsonBody: { error: "destination_location_id must reference an active location" } };
    request.input("transition", sql.NVarChar, result.value.transition); request.input("min", sql.Float, result.value.heading_min); request.input("max", sql.Float, result.value.heading_max); request.input("label", sql.NVarChar, result.value.destination_label?.trim() || null); request.input("location", sql.UniqueIdentifier, result.value.destination_location_id); request.input("messageType", sql.NVarChar, result.value.message_type); request.input("mode", sql.NVarChar, result.value.send_mode); request.input("sort", sql.Int, result.value.sort_order);
    const out = await request.query("UPDATE EventGeofenceDirectionRules SET transition=@transition,heading_min=@min,heading_max=@max,destination_label=@label,message_type=@messageType,destination_location_id=@location,send_mode=@mode,sort_order=@sort WHERE id=@id AND geofence_id=@geofence OUTPUT INSERTED.*");
  return out.recordset.length ? { status: 200, jsonBody: out.recordset[0] } : { status: 404, jsonBody: { error: "Rule not found" } };
} });

app.http("eventGeofenceUpdate", { route: "event-geofences/{id}", methods: ["PATCH"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  if (!isGuid(req.params.id)) return { status: 400, jsonBody: { error: "Geofence id must be a valid GUID" } };
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
  if (body.polygon !== undefined && typeof body.polygon !== "string") return { status: 400, jsonBody: { error: "polygon must be a string" } };
  const polygonError = typeof body.polygon === "string" ? validatePolygon(body.polygon) : null; if (polygonError) return { status: 400, jsonBody: { error: polygonError } };
  if (body.purpose !== undefined && !GEOFENCE_PURPOSES.includes(body.purpose as GeofencePurpose)) return { status: 400, jsonBody: { error: "purpose must be staging, corridor, venue, or other" } };
  if (body.expected_updated_at !== undefined && (typeof body.expected_updated_at !== "string" || Number.isNaN(Date.parse(body.expected_updated_at)))) return { status: 400, jsonBody: { error: "expected_updated_at must be a valid timestamp" } };
  const pool = await getPool(); if (await activePlanUsesGeofence(pool, req.params.id)) return { status: 409, jsonBody: { error: "Geofences used by an active Service Plan must be changed through a reviewed revision" } };
  const request = pool.request(); request.input("id", sql.UniqueIdentifier, req.params.id); request.input("name", sql.NVarChar, typeof body.name === "string" ? body.name.trim() : null); request.input("polygon", sql.NVarChar, typeof body.polygon === "string" ? body.polygon : null); request.input("purpose", sql.NVarChar, typeof body.purpose === "string" ? body.purpose : null); request.input("is_active", sql.Bit, body.is_active ?? true); request.input("by", sql.NVarChar, auth.principal.userDetails ?? "system"); request.input("expected", sql.DateTime2, typeof body.expected_updated_at === "string" ? new Date(body.expected_updated_at) : null);
  const out = await request.query("UPDATE EventGeofences SET name=COALESCE(@name,name),polygon=COALESCE(@polygon,polygon),purpose=COALESCE(@purpose,purpose),is_active=@is_active,updated_by=@by,updated_at=SYSUTCDATETIME() OUTPUT INSERTED.* WHERE id=@id AND (@expected IS NULL OR updated_at=@expected)");
  if (out.recordset.length) return { status: 200, jsonBody: out.recordset[0] };
  const exists = await request.query("SELECT TOP 1 id FROM EventGeofences WHERE id=@id");
  return exists.recordset.length ? { status: 409, jsonBody: { error: "Geofence changed since it was loaded. Reload before saving." } } : { status: 404, jsonBody: { error: "Geofence not found" } };
} });

app.http("eventGeofenceRules", { route: "event-geofences/{id}/rules", methods: ["POST"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = requireRole(req, ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  if (!isGuid(req.params.id)) return { status: 400, jsonBody: { error: "Geofence id must be a valid GUID" } };
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
  const pool = await getPool();
  const fence = await pool.request().input("geofence", sql.UniqueIdentifier, req.params.id).query("SELECT TOP 1 id FROM EventGeofences WHERE id=@geofence");
  if (!fence.recordset.length) return { status: 404, jsonBody: { error: "Geofence not found" } };
  if (await activePlanUsesGeofence(pool, req.params.id)) return { status: 409, jsonBody: { error: "Direction rules used by an active Service Plan must be changed through a reviewed revision" } };
  const result = validateDirectionRule({ ...body, id: "", geofence_id: req.params.id, message_type: (body.message_type ?? "custom") as DirectionRule["message_type"], send_mode: (body.send_mode ?? "manual") as DirectionRule["send_mode"], sort_order: Number(body.sort_order ?? 0) }, await readRules(pool, req.params.id));
  if (!result.ok) return { status: 400, jsonBody: { error: "Validation failed", details: result.errors } };
  if (result.value.destination_location_id && !(await activeLocation(pool, result.value.destination_location_id))) return { status: 400, jsonBody: { error: "destination_location_id must reference an active location" } };
  const request = pool.request(); request.input("geofence_id", sql.UniqueIdentifier, req.params.id); request.input("transition", sql.NVarChar, result.value.transition); request.input("min", sql.Float, result.value.heading_min); request.input("max", sql.Float, result.value.heading_max); request.input("label", sql.NVarChar, result.value.destination_label?.trim() || null); request.input("location", sql.UniqueIdentifier, result.value.destination_location_id); request.input("messageType", sql.NVarChar, result.value.message_type); request.input("mode", sql.NVarChar, result.value.send_mode); request.input("sort", sql.Int, result.value.sort_order);
  return { status: 201, jsonBody: (await request.query("INSERT INTO EventGeofenceDirectionRules(geofence_id,transition,heading_min,heading_max,destination_label,destination_location_id,message_type,send_mode,sort_order) OUTPUT INSERTED.* VALUES(@geofence_id,@transition,@min,@max,@label,@location,@messageType,@mode,@sort)")).recordset[0] };
} });
