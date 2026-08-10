import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES } from "../lib/auth";

const tableFor = (kind: string, revision = false) => ({
  routes: revision ? "EventServicePlanRevisionRoutes" : "EventServicePlanRoutes",
  geofences: revision ? "EventServicePlanRevisionGeofences" : "EventServicePlanGeofences",
  locations: revision ? "EventServicePlanRevisionLocations" : "EventServicePlanLocations",
} as Record<string, string>)[kind];
const keyFor = (kind: string) => kind === "routes" ? "route_id" : kind === "geofences" ? "geofence_id" : "location_id";

async function authorized(req: HttpRequest) {
  return requireRole(req, ADMIN_ROLES);
}

app.http("eventServicePlans", { route: "event-service-plans", methods: ["GET", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = await authorized(req); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const pool = await getPool();
  if (req.method === "GET") {
    const plans = (await pool.request().query("SELECT * FROM EventServicePlans ORDER BY created_at DESC")).recordset;
    const links = (await pool.request().query("SELECT 'routes' kind,spr.service_plan_id,CONVERT(nvarchar(36),spr.route_id) value,CONCAT('Route ',spr.route_id,CASE WHEN rc.route_label IS NULL THEN '' ELSE CONCAT(' · ',rc.route_label) END) label FROM EventServicePlanRoutes spr LEFT JOIN RouteClassification rc ON rc.route_id=spr.route_id UNION ALL SELECT 'geofences',spg.service_plan_id,CONVERT(nvarchar(36),spg.geofence_id),g.name FROM EventServicePlanGeofences spg JOIN EventGeofences g ON g.id=spg.geofence_id UNION ALL SELECT 'locations',spl.service_plan_id,CONVERT(nvarchar(36),spl.location_id),l.name FROM EventServicePlanLocations spl JOIN EventLocations l ON l.id=spl.location_id")).recordset;
    const revisions = (await pool.request().query("SELECT * FROM EventServicePlanRevisions ORDER BY created_at DESC")).recordset;
    return { status: 200, jsonBody: { plans: plans.map((plan) => ({ ...plan, links: links.filter((link) => link.service_plan_id === plan.id), revisions: revisions.filter((revision) => revision.service_plan_id === plan.id) })) } };
  }
  const body = await req.json() as Record<string, unknown>; if (typeof body.name !== "string" || !body.name.trim()) return { status: 400, jsonBody: { error: "name is required" } };
  const r = pool.request(); r.input("name", sql.NVarChar, body.name.trim()); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
  return { status: 201, jsonBody: (await r.query("INSERT INTO EventServicePlans(name,created_by,updated_by) OUTPUT INSERTED.* VALUES(@name,@by,@by)")).recordset[0] };
} });

app.http("eventServicePlanAction", { route: "event-service-plans/{id}/{action}", methods: ["PATCH", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = await authorized(req); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const action = req.params.action; const pool = await getPool(); const id = req.params.id;
  if (action === "modify") {
    const r = pool.request(); r.input("id", sql.UniqueIdentifier, id); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    const plan = (await r.query<{ status: string }>("SELECT status FROM EventServicePlans WHERE id=@id")).recordset[0];
    if (!plan) return { status: 404, jsonBody: { error: "Service plan not found" } };
    if (plan.status !== "active") return { status: 409, jsonBody: { error: "Only an active service plan can be modified" } };
    const revision = (await r.query<{ id: string }>("INSERT INTO EventServicePlanRevisions(service_plan_id,created_by,updated_by) OUTPUT INSERTED.id VALUES(@id,@by,@by)")).recordset[0];
    await pool.request().input("revision", sql.UniqueIdentifier, revision.id).input("plan", sql.UniqueIdentifier, id).query("INSERT INTO EventServicePlanRevisionRoutes(revision_id,route_id) SELECT @revision,route_id FROM EventServicePlanRoutes WHERE service_plan_id=@plan; INSERT INTO EventServicePlanRevisionGeofences(revision_id,geofence_id) SELECT @revision,geofence_id FROM EventServicePlanGeofences WHERE service_plan_id=@plan; INSERT INTO EventServicePlanRevisionLocations(revision_id,location_id) SELECT @revision,location_id FROM EventServicePlanLocations WHERE service_plan_id=@plan;");
    return { status: 201, jsonBody: { id: revision.id, service_plan_id: id, status: "draft" } };
  }
  if (["submit-review", "approve", "advance", "complete", "suspend"].includes(action)) {
    const transitions: Record<string, { from: string; to: string }> = { "submit-review": { from: "draft", to: "review" }, approve: { from: "review", to: "approved" }, advance: { from: "approved", to: "active" }, complete: { from: "active", to: "completed" }, suspend: { from: "active", to: "suspended" } };
    const transition = transitions[action]; const r = pool.request(); r.input("id", sql.UniqueIdentifier, id); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    if (action === "advance") { const counts = (await r.query("SELECT (SELECT COUNT(*) FROM EventServicePlanRoutes WHERE service_plan_id=@id) routes,(SELECT COUNT(*) FROM EventServicePlanGeofences WHERE service_plan_id=@id) geofences")).recordset[0] as { routes: number; geofences: number }; if (!counts || counts.routes < 1 || counts.geofences < 1) return { status: 409, jsonBody: { error: "An active plan must include at least one route and one geofence" } }; }
    const out = await r.query("UPDATE EventServicePlans SET status='" + transition.to + "',updated_by=@by,updated_at=SYSUTCDATETIME() OUTPUT INSERTED.* WHERE id=@id AND status='" + transition.from + "'"); return out.recordset.length ? { status: 200, jsonBody: out.recordset[0] } : { status: 409, jsonBody: { error: `Plan must be ${transition.from} before it can be ${transition.to}` } };
  }
  const kind = action === "routes" || action === "geofences" || action === "locations" ? action : null; const table = kind && tableFor(kind); if (!table) return { status: 404, jsonBody: { error: "Unknown service-plan action" } };
  const body = await req.json() as Record<string, unknown>; const key = keyFor(kind); const revisionId = req.query.get("revision_id");
  if (revisionId) {
    const revision = await pool.request().input("revision", sql.UniqueIdentifier, revisionId).input("plan", sql.UniqueIdentifier, id).query<{ status: string }>("SELECT status FROM EventServicePlanRevisions WHERE id=@revision AND service_plan_id=@plan");
    if (!revision.recordset[0] || !["draft", "review"].includes(revision.recordset[0].status)) return { status: 409, jsonBody: { error: "Revision is not editable" } };
    const revisionTable = tableFor(kind, true)!; const r = pool.request(); r.input("revision", sql.UniqueIdentifier, revisionId); r.input("value", kind === "routes" ? sql.Int : sql.UniqueIdentifier, kind === "routes" ? Number(body[key]) : body[key]); await r.query(`INSERT INTO ${revisionTable}(revision_id,${key}) VALUES(@revision,@value)`); return { status: 201, jsonBody: { ok: true, revision_id: revisionId } };
  }
  const plan = await pool.request().input("plan", sql.UniqueIdentifier, id).query<{ status: string }>("SELECT status FROM EventServicePlans WHERE id=@plan");
  if (!plan.recordset[0]) return { status: 404, jsonBody: { error: "Service plan not found" } };
  if (!["draft", "review"].includes(plan.recordset[0].status)) return { status: 409, jsonBody: { error: "Active plan resources must be changed through a revision" } };
  const r = pool.request(); r.input("plan", sql.UniqueIdentifier, id); r.input("value", kind === "routes" ? sql.Int : sql.UniqueIdentifier, kind === "routes" ? Number(body[key]) : body[key]); await r.query(`INSERT INTO ${table}(service_plan_id,${key}) VALUES(@plan,@value)`); return { status: 201, jsonBody: { ok: true } };
} });

app.http("eventServicePlanRevisionAction", { route: "event-service-plans/{id}/revisions/{revisionId}/{action}", methods: ["POST", "PATCH"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = await authorized(req); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const action = req.params.action; const transition: Record<string, { from: string; to: string }> = { "submit-review": { from: "draft", to: "review" }, approve: { from: "review", to: "approved" }, reject: { from: "review", to: "rejected" } };
  const pool = await getPool(); const revisionId = req.params.revisionId; const planId = req.params.id; const r = pool.request(); r.input("revision", sql.UniqueIdentifier, revisionId); r.input("plan", sql.UniqueIdentifier, planId); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
  if (action === "apply") {
    const current = (await r.query<{ status: string }>("SELECT r.status,p.status plan_status FROM EventServicePlanRevisions r JOIN EventServicePlans p ON p.id=r.service_plan_id WHERE r.id=@revision AND r.service_plan_id=@plan")).recordset[0] as { status: string; plan_status: string } | undefined;
    if (!current || current.status !== "approved" || current.plan_status !== "active") return { status: 409, jsonBody: { error: "An approved revision can only be applied to an active plan" } };
    const transaction = pool.transaction(); await transaction.begin();
    try {
      await transaction.request().input("revision", sql.UniqueIdentifier, revisionId).input("plan", sql.UniqueIdentifier, planId).input("by", sql.NVarChar, auth.principal.userDetails ?? "system").query("DELETE FROM EventServicePlanRoutes WHERE service_plan_id=@plan; INSERT INTO EventServicePlanRoutes SELECT @plan,route_id FROM EventServicePlanRevisionRoutes WHERE revision_id=@revision; DELETE FROM EventServicePlanGeofences WHERE service_plan_id=@plan; INSERT INTO EventServicePlanGeofences SELECT @plan,geofence_id FROM EventServicePlanRevisionGeofences WHERE revision_id=@revision; DELETE FROM EventServicePlanLocations WHERE service_plan_id=@plan; INSERT INTO EventServicePlanLocations SELECT @plan,location_id FROM EventServicePlanRevisionLocations WHERE revision_id=@revision; UPDATE EventServicePlanRevisions SET status='applied',updated_by=@by,updated_at=SYSUTCDATETIME() WHERE id=@revision;");
      await transaction.commit();
    } catch (error) { await transaction.rollback(); throw error; }
    return { status: 200, jsonBody: { ok: true, status: "applied" } };
  }
  if (!transition[action]) return { status: 404, jsonBody: { error: "Unknown revision action" } };
  const out = await r.query("UPDATE EventServicePlanRevisions SET status='" + transition[action].to + "',updated_by=@by,updated_at=SYSUTCDATETIME() WHERE id=@revision AND service_plan_id=@plan AND status='" + transition[action].from + "'"); return out.rowsAffected[0] ? { status: 200, jsonBody: { ok: true, status: transition[action].to } } : { status: 409, jsonBody: { error: `Revision must be ${transition[action].from} before it can be ${transition[action].to}` } };
} });

app.http("eventServicePlanResourceDelete", { route: "event-service-plans/{id}/{kind}/{value}", methods: ["DELETE"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = await authorized(req); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const kind = req.params.kind; const table = kind && tableFor(kind); if (!table) return { status: 404, jsonBody: { error: "Unknown service-plan resource" } };
  const key = keyFor(kind); const pool = await getPool(); const revisionId = req.query.get("revision_id");
  if (revisionId) {
    const revision = await pool.request().input("revision", sql.UniqueIdentifier, revisionId).input("plan", sql.UniqueIdentifier, req.params.id).query<{ status: string }>("SELECT status FROM EventServicePlanRevisions WHERE id=@revision AND service_plan_id=@plan");
    if (!revision.recordset[0] || !["draft", "review"].includes(revision.recordset[0].status)) return { status: 409, jsonBody: { error: "Revision is not editable" } };
    const r = pool.request(); r.input("revision", sql.UniqueIdentifier, revisionId); r.input("value", kind === "routes" ? sql.Int : sql.UniqueIdentifier, kind === "routes" ? Number(req.params.value) : req.params.value); const out = await r.query(`DELETE FROM ${tableFor(kind, true)} WHERE revision_id=@revision AND ${key}=@value`); return out.rowsAffected[0] ? { status: 204 } : { status: 404, jsonBody: { error: "Resource link not found" } };
  }
  const plan = await pool.request().input("plan", sql.UniqueIdentifier, req.params.id).query<{ status: string }>("SELECT status FROM EventServicePlans WHERE id=@plan");
  if (!plan.recordset[0]) return { status: 404, jsonBody: { error: "Service plan not found" } };
  if (!["draft", "review"].includes(plan.recordset[0].status)) return { status: 409, jsonBody: { error: "Active plan resources must be changed through a revision" } };
  const r = pool.request(); r.input("plan", sql.UniqueIdentifier, req.params.id); r.input("value", kind === "routes" ? sql.Int : sql.UniqueIdentifier, kind === "routes" ? Number(req.params.value) : req.params.value); const out = await r.query(`DELETE FROM ${table} WHERE service_plan_id=@plan AND ${key}=@value`); return out.rowsAffected[0] ? { status: 204 } : { status: 404, jsonBody: { error: "Resource link not found" } };
} });
