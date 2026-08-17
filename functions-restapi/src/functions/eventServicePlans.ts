import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES } from "../lib/auth";
import { validateOperatingPeriod } from "../lib/eventOperatingPeriods";
import { validateEventPlanReadiness, type EventPlanReadiness } from "../lib/eventPlanValidation";

const tableFor = (kind: string, revision = false) => ({
  routes: revision ? "EventServicePlanRevisionRoutes" : "EventServicePlanRoutes",
  geofences: revision ? "EventServicePlanRevisionGeofences" : "EventServicePlanGeofences",
  locations: revision ? "EventServicePlanRevisionLocations" : "EventServicePlanLocations",
} as Record<string, string>)[kind];
const keyFor = (kind: string) => kind === "routes" ? "route_id" : kind === "geofences" ? "geofence_id" : "location_id";

async function captureScopeSnapshot(pool: Awaited<ReturnType<typeof getPool>>, planId: string, actor: string, revisionId: string | null = null) {
  const routes = (await pool.request().input("plan", sql.UniqueIdentifier, planId).query("SELECT rc.route_id,rc.route_label,rc.route_category,rc.is_active FROM EventServicePlanRoutes link JOIN RouteClassification rc ON rc.route_id=link.route_id WHERE link.service_plan_id=@plan ORDER BY rc.route_id")).recordset;
  const geofences = (await pool.request().input("plan", sql.UniqueIdentifier, planId).query("SELECT g.id geofence_id,g.name,g.polygon,g.purpose,g.is_active FROM EventServicePlanGeofences link JOIN EventGeofences g ON g.id=link.geofence_id WHERE link.service_plan_id=@plan ORDER BY g.id")).recordset;
  const locations = (await pool.request().input("plan", sql.UniqueIdentifier, planId).query("SELECT l.id location_id,l.name,l.category,l.latitude,l.longitude,l.notes,l.is_active FROM EventServicePlanLocations link JOIN EventLocations l ON l.id=link.location_id WHERE link.service_plan_id=@plan ORDER BY l.id")).recordset;
  const rules = (await pool.request().input("plan", sql.UniqueIdentifier, planId).query("SELECT r.* FROM EventServicePlanGeofences link JOIN EventGeofenceDirectionRules r ON r.geofence_id=link.geofence_id WHERE link.service_plan_id=@plan ORDER BY r.geofence_id,r.transition,r.sort_order,r.id")).recordset;
  const request = pool.request();
  request.input("plan", sql.UniqueIdentifier, planId);
  request.input("revision", sql.UniqueIdentifier, revisionId);
  request.input("by", sql.NVarChar, actor);
  request.input("routes", sql.NVarChar(sql.MAX), JSON.stringify(routes));
  request.input("geofences", sql.NVarChar(sql.MAX), JSON.stringify(geofences));
  request.input("locations", sql.NVarChar(sql.MAX), JSON.stringify(locations));
  request.input("rules", sql.NVarChar(sql.MAX), JSON.stringify(rules));
  return (await request.query("INSERT INTO EventServicePlanScopeSnapshots(service_plan_id,revision_id,captured_by,routes_json,geofences_json,locations_json,rules_json) OUTPUT INSERTED.* VALUES(@plan,@revision,@by,@routes,@geofences,@locations,@rules)")).recordset[0];
}

async function readPlanReadiness(pool: Awaited<ReturnType<typeof getPool>>, planId: string): Promise<EventPlanReadiness> {
  const request = pool.request().input("id", sql.UniqueIdentifier, planId);
  const result = await request.query<EventPlanReadiness>(`
    SELECT
      (SELECT COUNT(DISTINCT spr.route_id) FROM EventServicePlanRoutes spr JOIN RouteClassification rc ON rc.route_id=spr.route_id WHERE spr.service_plan_id=@id AND rc.route_category='SpecialEvent' AND rc.is_active=1) AS routeCount,
      (SELECT COUNT(DISTINCT spg.geofence_id) FROM EventServicePlanGeofences spg JOIN EventGeofences g ON g.id=spg.geofence_id WHERE spg.service_plan_id=@id AND g.is_active=1) AS geofenceCount,
      (SELECT COUNT(DISTINCT spg.geofence_id) FROM EventServicePlanGeofences spg JOIN EventGeofences g ON g.id=spg.geofence_id JOIN EventGeofenceDirectionRules dr ON dr.geofence_id=spg.geofence_id WHERE spg.service_plan_id=@id AND g.is_active=1) AS geofencesWithRules,
      CASE WHEN EXISTS (SELECT 1 FROM EventServicePlans WHERE id=@id AND ((start_at IS NOT NULL AND end_at IS NOT NULL AND start_at < end_at) OR (start_at IS NULL AND end_at IS NULL AND (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)))) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS validDates,
      CASE WHEN EXISTS (
        SELECT 1 FROM EventServicePlanRoutes candidate
        JOIN EventServicePlanRoutes activeRoute ON activeRoute.route_id=candidate.route_id AND activeRoute.service_plan_id<>@id
        JOIN EventServicePlans activePlan ON activePlan.id=activeRoute.service_plan_id AND activePlan.status='active'
        JOIN EventServicePlans candidatePlan ON candidatePlan.id=candidate.service_plan_id
        WHERE candidate.service_plan_id=@id
          AND COALESCE(candidatePlan.start_at, CAST(candidatePlan.start_date AS DATETIME2)) < COALESCE(activePlan.end_at, DATEADD(day, 1, CAST(activePlan.end_date AS DATETIME2)))
          AND COALESCE(activePlan.start_at, CAST(activePlan.start_date AS DATETIME2)) < COALESCE(candidatePlan.end_at, DATEADD(day, 1, CAST(candidatePlan.end_date AS DATETIME2)))
      ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS routeConflict
  `);
  return result.recordset[0] ?? { routeCount: 0, geofenceCount: 0, geofencesWithRules: 0, validDates: false, routeConflict: false };
}

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
    const revisionLinks = (await pool.request().query("SELECT 'routes' kind,r.revision_id,sp.service_plan_id,CONVERT(nvarchar(36),r.route_id) value,CONCAT('Route ',r.route_id,CASE WHEN rc.route_label IS NULL THEN '' ELSE CONCAT(' · ',rc.route_label) END) label FROM EventServicePlanRevisionRoutes r JOIN EventServicePlanRevisions sp ON sp.id=r.revision_id LEFT JOIN RouteClassification rc ON rc.route_id=r.route_id UNION ALL SELECT 'geofences',r.revision_id,sp.service_plan_id,CONVERT(nvarchar(36),r.geofence_id),g.name FROM EventServicePlanRevisionGeofences r JOIN EventServicePlanRevisions sp ON sp.id=r.revision_id JOIN EventGeofences g ON g.id=r.geofence_id UNION ALL SELECT 'locations',r.revision_id,sp.service_plan_id,CONVERT(nvarchar(36),r.location_id),l.name FROM EventServicePlanRevisionLocations r JOIN EventServicePlanRevisions sp ON sp.id=r.revision_id JOIN EventLocations l ON l.id=r.location_id")).recordset;
    const readinessByPlan = new Map((await Promise.all(plans.map(async (plan) => [String(plan.id), await readPlanReadiness(pool, String(plan.id))] as const))).map(([id, readiness]) => [id, readiness]));
    const snapshots = (await pool.request().query("SELECT service_plan_id,routes_json,geofences_json,locations_json,rules_json FROM (SELECT s.*,ROW_NUMBER() OVER (PARTITION BY service_plan_id ORDER BY captured_at DESC) snapshot_rank FROM EventServicePlanScopeSnapshots s) latest WHERE snapshot_rank=1")).recordset;
    const snapshotFor = new Map(snapshots.map((snapshot) => [String(snapshot.service_plan_id), snapshot]));
    const parse = (value: unknown): unknown[] => { try { return typeof value === "string" ? JSON.parse(value) as unknown[] : []; } catch { return []; } };
    const publishedScope = (plan: typeof plans[number]) => {
      if (plan.status !== "active") return null;
      const snapshot = snapshotFor.get(String(plan.id));
      if (!snapshot) return null;
      const geofences = parse(snapshot.geofences_json) as Record<string, unknown>[];
      const locations = parse(snapshot.locations_json) as Record<string, unknown>[];
      const rules = parse(snapshot.rules_json) as Record<string, unknown>[];
      return {
        routes: parse(snapshot.routes_json) as Record<string, unknown>[],
        geofences: geofences.map((row) => ({ ...row, purpose: row.purpose ?? "other", id: row.geofence_id, rules: rules.filter((rule) => rule.geofence_id === row.geofence_id) })),
        locations: locations.map((row) => ({ ...row, id: row.location_id })),
      };
    };
    return { status: 200, jsonBody: { plans: plans.map((plan) => ({ ...plan, route_conflict: readinessByPlan.get(String(plan.id))?.routeConflict ?? false, links: links.filter((link) => link.service_plan_id === plan.id), revisions: revisions.filter((revision) => revision.service_plan_id === plan.id).map((revision) => ({ ...revision, links: revisionLinks.filter((link) => link.revision_id === revision.id) })), published_scope: publishedScope(plan) })) } };
  }
  const body = await req.json() as Record<string, unknown>; if (typeof body.name !== "string" || !body.name.trim()) return { status: 400, jsonBody: { error: "name is required" } };
  const hasStart = body.start_at !== undefined && body.start_at !== null;
  const hasEnd = body.end_at !== undefined && body.end_at !== null;
  if (hasStart !== hasEnd) return { status: 400, jsonBody: { error: "start_at and end_at must be provided together" } };
  if (hasStart) {
    const period = validateOperatingPeriod({ start_at: String(body.start_at), end_at: String(body.end_at) });
    if (!period.valid) return { status: 400, jsonBody: { error: period.error } };
  }
  const actor = auth.principal.userDetails ?? "system";
  const transaction = pool.transaction(); await transaction.begin();
  try {
    const r = transaction.request(); r.input("name", sql.NVarChar, body.name.trim()); r.input("by", sql.NVarChar, actor);
    r.input("start", sql.DateTime2, hasStart ? new Date(String(body.start_at)) : null);
    r.input("end", sql.DateTime2, hasEnd ? new Date(String(body.end_at)) : null);
    let eventId = typeof body.event_id === "string" ? body.event_id : null;
    if (eventId) {
      r.input("event", sql.UniqueIdentifier, eventId);
      if (!(await r.query("SELECT id FROM Events WHERE id=@event")).recordset.length) { await transaction.rollback(); return { status: 404, jsonBody: { error: "Event not found" } }; }
    } else {
      const eventRequest = transaction.request();
      eventRequest.input("name", sql.NVarChar, body.name.trim());
      eventRequest.input("by", sql.NVarChar, actor);
      eventId = (await eventRequest.query("INSERT INTO Events(name,created_by,updated_by) OUTPUT INSERTED.id VALUES(@name,@by,@by)")).recordset[0].id;
    }
    if (!r.parameters.event) r.input("event", sql.UniqueIdentifier, eventId);
    const plan = (await r.query("INSERT INTO EventServicePlans(event_id,name,start_at,end_at,created_by,updated_by) OUTPUT INSERTED.* VALUES(@event,@name,@start,@end,@by,@by)")).recordset[0];
    await transaction.commit();
    return { status: 201, jsonBody: plan };
  } catch (error) { await transaction.rollback(); throw error; }
} });

app.http("eventServicePlanAction", { route: "event-service-plans/{id}/{action}", methods: ["PATCH", "POST"], authLevel: "anonymous", handler: async (req: HttpRequest) => {
  const auth = await authorized(req); if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
  const action = req.params.action; const pool = await getPool(); const id = req.params.id;
  if (action === "details") {
    const body = await req.json() as Record<string, unknown>;
    const current = (await pool.request().input("id", sql.UniqueIdentifier, id).query<{ status: string }>("SELECT status FROM EventServicePlans WHERE id=@id")).recordset[0];
    if (!current) return { status: 404, jsonBody: { error: "Service plan not found" } };
    if (!["draft", "review"].includes(current.status)) return { status: 409, jsonBody: { error: "Only draft or review plans can be edited" } };
    const hasStart = body.start_at !== undefined && body.start_at !== null;
    const hasEnd = body.end_at !== undefined && body.end_at !== null;
    if (hasStart !== hasEnd) return { status: 400, jsonBody: { error: "start_at and end_at must be provided together" } };
    if (hasStart) {
      const period = validateOperatingPeriod({ start_at: String(body.start_at), end_at: String(body.end_at) });
      if (!period.valid) return { status: 400, jsonBody: { error: period.error } };
    }
    const request = pool.request().input("id", sql.UniqueIdentifier, id).input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    const fields: string[] = [];
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) return { status: 400, jsonBody: { error: "name must not be empty" } };
      request.input("name", sql.NVarChar, body.name.trim()); fields.push("name=@name");
    }
    if (hasStart) {
      request.input("start", sql.DateTime2, new Date(String(body.start_at)));
      request.input("end", sql.DateTime2, new Date(String(body.end_at)));
      fields.push("start_at=@start", "end_at=@end");
    }
    if (!fields.length) return { status: 400, jsonBody: { error: "At least one plan field is required" } };
    fields.push("updated_by=@by", "updated_at=SYSUTCDATETIME()");
    const updated = (await request.query(`UPDATE EventServicePlans SET ${fields.join(",")} OUTPUT INSERTED.* WHERE id=@id`)).recordset[0];
    return updated ? { status: 200, jsonBody: updated } : { status: 404, jsonBody: { error: "Service plan not found" } };
  }
  if (action === "modify") {
    const r = pool.request(); r.input("id", sql.UniqueIdentifier, id); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    const plan = (await r.query<{ status: string }>("SELECT status FROM EventServicePlans WHERE id=@id")).recordset[0];
    if (!plan) return { status: 404, jsonBody: { error: "Service plan not found" } };
    if (plan.status !== "active") return { status: 409, jsonBody: { error: "Only an active service plan can be modified" } };
    const revision = (await r.query<{ id: string }>("INSERT INTO EventServicePlanRevisions(service_plan_id,start_at,end_at,created_by,updated_by) OUTPUT INSERTED.id SELECT id,start_at,end_at,@by,@by FROM EventServicePlans WHERE id=@id")).recordset[0];
    await pool.request().input("revision", sql.UniqueIdentifier, revision.id).input("plan", sql.UniqueIdentifier, id).query("INSERT INTO EventServicePlanRevisionRoutes(revision_id,route_id) SELECT @revision,route_id FROM EventServicePlanRoutes WHERE service_plan_id=@plan; INSERT INTO EventServicePlanRevisionGeofences(revision_id,geofence_id) SELECT @revision,geofence_id FROM EventServicePlanGeofences WHERE service_plan_id=@plan; INSERT INTO EventServicePlanRevisionLocations(revision_id,location_id) SELECT @revision,location_id FROM EventServicePlanLocations WHERE service_plan_id=@plan;");
    return { status: 201, jsonBody: { id: revision.id, service_plan_id: id, status: "draft" } };
  }
  if (action === "repair") {
    const transaction = pool.transaction(); await transaction.begin();
    try {
      const source = (await transaction.request().input("id", sql.UniqueIdentifier, id).query<{ event_id: string; name: string; start_at: Date | null; end_at: Date | null }>("SELECT event_id,name,start_at,end_at FROM EventServicePlans WHERE id=@id AND status='approved'")).recordset[0];
      if (!source) { await transaction.rollback(); return { status: 409, jsonBody: { error: "Only an approved operating period can be repaired" } }; }
      const created = (await transaction.request().input("event", sql.UniqueIdentifier, source.event_id).input("name", sql.NVarChar, `${source.name} · Repair`).input("start", sql.DateTime2, source.start_at).input("end", sql.DateTime2, source.end_at).input("by", sql.NVarChar, auth.principal.userDetails ?? "system").query("INSERT INTO EventServicePlans(event_id,name,status,start_at,end_at,created_by,updated_by) OUTPUT INSERTED.* VALUES(@event,@name,'draft',@start,@end,@by,@by)")).recordset[0];
      await transaction.request().input("source", sql.UniqueIdentifier, id).input("target", sql.UniqueIdentifier, created.id).query("INSERT INTO EventServicePlanRoutes SELECT @target,route_id FROM EventServicePlanRoutes WHERE service_plan_id=@source; INSERT INTO EventServicePlanGeofences SELECT @target,geofence_id FROM EventServicePlanGeofences WHERE service_plan_id=@source; INSERT INTO EventServicePlanLocations SELECT @target,location_id FROM EventServicePlanLocations WHERE service_plan_id=@source");
      await transaction.commit();
      return { status: 201, jsonBody: created };
    } catch (error) { await transaction.rollback(); throw error; }
  }
  if (["submit-review", "approve", "advance", "complete", "suspend"].includes(action)) {
    const transitions: Record<string, { from: string; to: string }> = { "submit-review": { from: "draft", to: "review" }, approve: { from: "review", to: "approved" }, advance: { from: "approved", to: "active" }, complete: { from: "active", to: "completed" }, suspend: { from: "active", to: "suspended" } };
    const transition = transitions[action]; const r = pool.request(); r.input("id", sql.UniqueIdentifier, id); r.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    let conflictOverrideReason: string | null = null;
    if (action === "approve" || action === "advance") {
      try {
        const body = await req.json() as { conflict_override_reason?: unknown };
        if (typeof body.conflict_override_reason === "string") conflictOverrideReason = body.conflict_override_reason.trim() || null;
      } catch { /* an empty body is valid when no override is needed */ }
    }
    if (action === "approve" || action === "advance") {
      const readiness = await readPlanReadiness(pool, id);
      const validation = validateEventPlanReadiness(readiness, conflictOverrideReason);
      if (!validation.valid) return { status: 409, jsonBody: { error: validation.error } };
      if (readiness.routeConflict && conflictOverrideReason) {
        await pool.request().input("plan", sql.UniqueIdentifier, id).input("type", sql.NVarChar, "route_overlap").input("key", sql.NVarChar, "active-route-overlap").input("reason", sql.NVarChar(1000), conflictOverrideReason).input("by", sql.NVarChar, auth.principal.userDetails ?? "system").query("INSERT INTO EventServicePlanConflictOverrides(service_plan_id,conflict_type,conflict_key,reason,created_by) VALUES(@plan,@type,@key,@reason,@by)");
      }
    }
    if (action === "advance") {
      await captureScopeSnapshot(pool, id, auth.principal.userDetails ?? "system");
    }
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
      await transaction.request().input("revision", sql.UniqueIdentifier, revisionId).input("plan", sql.UniqueIdentifier, planId).input("by", sql.NVarChar, auth.principal.userDetails ?? "system").query("DELETE FROM EventServicePlanRoutes WHERE service_plan_id=@plan; INSERT INTO EventServicePlanRoutes SELECT @plan,route_id FROM EventServicePlanRevisionRoutes WHERE revision_id=@revision; DELETE FROM EventServicePlanGeofences WHERE service_plan_id=@plan; INSERT INTO EventServicePlanGeofences SELECT @plan,geofence_id FROM EventServicePlanRevisionGeofences WHERE revision_id=@revision; DELETE FROM EventServicePlanLocations WHERE service_plan_id=@plan; INSERT INTO EventServicePlanLocations SELECT @plan,location_id FROM EventServicePlanRevisionLocations WHERE revision_id=@revision; UPDATE EventServicePlans SET start_at=(SELECT start_at FROM EventServicePlanRevisions WHERE id=@revision),end_at=(SELECT end_at FROM EventServicePlanRevisions WHERE id=@revision),updated_by=@by,updated_at=SYSUTCDATETIME() WHERE id=@plan; UPDATE EventServicePlanRevisions SET status='applied',updated_by=@by,updated_at=SYSUTCDATETIME() WHERE id=@revision;");
      await transaction.commit();
    } catch (error) { await transaction.rollback(); throw error; }
    await captureScopeSnapshot(pool, planId, auth.principal.userDetails ?? "system", revisionId);
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
