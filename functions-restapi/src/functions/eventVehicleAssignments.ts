import { app, type HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES } from "../lib/auth";
import { assignmentTarget, type AssignmentPlanStatus } from "../lib/eventAssignments";

async function authorized(req: HttpRequest) {
  return requireRole(req, ADMIN_ROLES);
}

app.http("eventVehicleAssignments", {
  route: "event-vehicle-assignments",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest) => {
    const auth = await authorized(req);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const pool = await getPool();
    if (req.method === "GET") {
      const request = pool.request();
      const eventId = req.query.get("event_id");
      if (eventId) request.input("event", sql.UniqueIdentifier, eventId);
      const where = eventId ? "WHERE a.event_id=@event" : "";
      const assignments = (await request.query(`SELECT a.*,e.name event_name,p.name service_plan_name FROM EventVehicleAssignments a JOIN Events e ON e.id=a.event_id JOIN EventServicePlans p ON p.id=a.service_plan_id ${where} ORDER BY a.requested_at DESC`)).recordset;
      return { status: 200, jsonBody: { assignments } };
    }
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.event_id !== "string" || typeof body.service_plan_id !== "string" || !Number.isInteger(body.vehicle_id) || !Number.isInteger(body.route_id)) {
      return { status: 400, jsonBody: { error: "event_id, service_plan_id, vehicle_id, and route_id are required" } };
    }
    const request = pool.request();
    request.input("event", sql.UniqueIdentifier, body.event_id);
    request.input("plan", sql.UniqueIdentifier, body.service_plan_id);
    request.input("vehicle", sql.Int, body.vehicle_id);
    request.input("route", sql.Int, body.route_id);
    request.input("reason", sql.NVarChar, typeof body.reason === "string" ? body.reason.trim() || null : null);
    request.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    const context = (await request.query<{ event_id: string; status: AssignmentPlanStatus; route_category: string; is_active: boolean }>("SELECT p.event_id,p.status,rc.route_category,rc.is_active FROM EventServicePlans p JOIN RouteClassification rc ON rc.route_id=@route WHERE p.id=@plan AND p.event_id=@event")).recordset[0];
    if (!context) return { status: 404, jsonBody: { error: "Event, plan, or route was not found in the selected context" } };
    if (context.route_category !== "SpecialEvent" || !context.is_active) return { status: 409, jsonBody: { error: "Only active SpecialEvent routes can be proposed" } };
    if (assignmentTarget(context.status) === "invalid") return { status: 409, jsonBody: { error: "Only draft, review, or active plans can receive assignment proposals" } };
    const assignment = (await request.query("INSERT INTO EventVehicleAssignments(event_id,service_plan_id,vehicle_id,route_id,reason,requested_by) OUTPUT INSERTED.* VALUES(@event,@plan,@vehicle,@route,@reason,@by)")).recordset[0];
    return { status: 201, jsonBody: assignment };
  },
});

app.http("eventVehicleAssignmentAction", {
  route: "event-vehicle-assignments/{id}/{action}",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest) => {
    const auth = await authorized(req);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = req.params.id;
    const action = req.params.action;
    const pool = await getPool();
    const request = pool.request();
    request.input("id", sql.UniqueIdentifier, id);
    request.input("by", sql.NVarChar, auth.principal.userDetails ?? "system");
    const assignment = (await request.query<{ id: string; service_plan_id: string; route_id: number; status: "proposed" | "accepted" | "applied" | "rejected"; plan_status: AssignmentPlanStatus }>("SELECT a.id,a.service_plan_id,a.route_id,a.status,p.status plan_status FROM EventVehicleAssignments a JOIN EventServicePlans p ON p.id=a.service_plan_id WHERE a.id=@id")).recordset[0];
    if (!assignment) return { status: 404, jsonBody: { error: "Assignment proposal not found" } };
    if (action === "reject") {
      const out = await request.query("UPDATE EventVehicleAssignments SET status='rejected',reviewed_by=@by,reviewed_at=SYSUTCDATETIME() WHERE id=@id AND status='proposed'");
      return out.rowsAffected[0] ? { status: 200, jsonBody: { status: "rejected" } } : { status: 409, jsonBody: { error: "Assignment is no longer proposed" } };
    }
    if (action !== "approve") return { status: 404, jsonBody: { error: "Unknown assignment action" } };
    if (assignment.status !== "proposed") return { status: 409, jsonBody: { error: "Assignment is no longer proposed" } };
    const target = assignmentTarget(assignment.plan_status);
    if (target === "invalid") return { status: 409, jsonBody: { error: "The plan no longer accepts assignments" } };
    const transaction = pool.transaction(); await transaction.begin();
    try {
      if (target === "plan") {
        await transaction.request().input("plan", sql.UniqueIdentifier, assignment.service_plan_id).input("route", sql.Int, assignment.route_id).query("IF NOT EXISTS (SELECT 1 FROM EventServicePlanRoutes WHERE service_plan_id=@plan AND route_id=@route) INSERT INTO EventServicePlanRoutes(service_plan_id,route_id) VALUES(@plan,@route)");
        await transaction.request().input("id", sql.UniqueIdentifier, id).input("by", sql.NVarChar, auth.principal.userDetails ?? "system").query("UPDATE EventVehicleAssignments SET status='applied',reviewed_by=@by,reviewed_at=SYSUTCDATETIME() WHERE id=@id AND status='proposed'");
        await transaction.commit();
        return { status: 200, jsonBody: { status: "applied", target: "plan" } };
      }
      const revision = (await transaction.request().input("plan", sql.UniqueIdentifier, assignment.service_plan_id).input("by", sql.NVarChar, auth.principal.userDetails ?? "system").query<{ id: string }>("INSERT INTO EventServicePlanRevisions(service_plan_id,start_at,end_at,created_by,updated_by) OUTPUT INSERTED.id SELECT id,start_at,end_at,@by,@by FROM EventServicePlans WHERE id=@plan")).recordset[0];
      await transaction.request().input("revision", sql.UniqueIdentifier, revision.id).input("plan", sql.UniqueIdentifier, assignment.service_plan_id).input("assignment", sql.UniqueIdentifier, id).query("INSERT INTO EventServicePlanRevisionRoutes(revision_id,route_id) SELECT @revision,route_id FROM EventServicePlanRoutes WHERE service_plan_id=@plan; INSERT INTO EventServicePlanRevisionGeofences(revision_id,geofence_id) SELECT @revision,geofence_id FROM EventServicePlanGeofences WHERE service_plan_id=@plan; INSERT INTO EventServicePlanRevisionLocations(revision_id,location_id) SELECT @revision,location_id FROM EventServicePlanLocations WHERE service_plan_id=@plan; IF NOT EXISTS (SELECT 1 FROM EventServicePlanRevisionRoutes WHERE revision_id=@revision AND route_id=(SELECT route_id FROM EventVehicleAssignments WHERE id=@assignment)) INSERT INTO EventServicePlanRevisionRoutes(revision_id,route_id) SELECT @revision,route_id FROM EventVehicleAssignments WHERE id=@assignment;");
      await transaction.request().input("assignment", sql.UniqueIdentifier, id).input("revision", sql.UniqueIdentifier, revision.id).input("by", sql.NVarChar, auth.principal.userDetails ?? "system").query("UPDATE EventVehicleAssignments SET status='accepted',revision_id=@revision,reviewed_by=@by,reviewed_at=SYSUTCDATETIME() WHERE id=@assignment AND status='proposed'");
      await transaction.commit();
      return { status: 200, jsonBody: { status: "accepted", target: "revision", revision_id: revision.id } };
    } catch (error) { await transaction.rollback(); throw error; }
  },
});
