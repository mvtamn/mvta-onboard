import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_READ_ROLES, DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid, validateCreateDetourIntake, validatePromoteDetourIntake } from "../lib/validation";
import { toDateOnly } from "../lib/detourStatus";
import { detourNumberYear } from "../lib/detourNumbering";
import { allocateDetourNumber } from "../lib/detourNumberAllocator";
import type { DetourFulfillmentMode } from "../lib/types";

const INTAKE_STATUSES = ["pending_review", "accepted", "rejected", "duplicate"] as const;
type IntakeStatus = (typeof INTAKE_STATUSES)[number];

function parseJson(request: HttpRequest): Promise<Record<string, unknown>> {
  return request.json() as Promise<Record<string, unknown>>;
}

app.http("detourIntakeList", {
  route: "detour-intake",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const status = request.query.get("status");
      const pool = await getPool();
      const req = pool.request();
      const where = INTAKE_STATUSES.includes(status as IntakeStatus) ? "WHERE i.status = @status" : "";
      if (where) req.input("status", sql.NVarChar(20), status);
      const result = await req.query(`
        SELECT i.id, i.detection_source, i.description, i.location,
               i.proposed_start_date, i.proposed_end_date, i.status,
               i.decision_notes, i.reviewed_by, i.reviewed_at,
               i.promoted_detour_id, i.created_by, i.created_at,
               i.updated_by, i.updated_at
        FROM DetourIntake i ${where}
        ORDER BY i.created_at DESC
      `);
      return {
        status: 200,
        jsonBody: {
          intake: result.recordset.map((row) => ({
            ...row,
            proposed_start_date: toDateOnly(row.proposed_start_date),
            proposed_end_date: toDateOnly(row.proposed_end_date),
          })),
        },
      };
    } catch (err) {
      context.error("GET /detour-intake failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourIntakeCreate", {
  route: "detour-intake",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    let body: Record<string, unknown>;
    try {
      body = await parseJson(request);
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateCreateDetourIntake(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    try {
      const pool = await getPool();
      const req = pool.request();
      req.input("detection_source", sql.NVarChar(100), body.detection_source);
      req.input("description", sql.NVarChar(1000), body.description);
      req.input("location", sql.NVarChar(500), body.location ?? null);
      req.input("proposed_start_date", sql.Date, body.proposed_start_date ?? null);
      req.input("proposed_end_date", sql.Date, body.proposed_end_date ?? null);
      req.input("created_by", sql.NVarChar(200), auth.principal.userDetails || "system");
      const inserted = await req.query<{ id: string; created_at: Date }>(`
        INSERT INTO DetourIntake
          (detection_source, description, location, proposed_start_date, proposed_end_date, created_by)
        OUTPUT INSERTED.id, INSERTED.created_at
        VALUES (@detection_source, @description, @location, @proposed_start_date, @proposed_end_date, @created_by)
      `);
      const intake = inserted.recordset[0];
      for (const [index, segment] of ((body.segments as Array<Record<string, unknown>> | undefined) ?? []).entries()) {
        const segmentReq = pool.request();
        segmentReq.input("intake_id", sql.UniqueIdentifier, intake.id);
        segmentReq.input("routes", sql.NVarChar(200), segment.routes);
        segmentReq.input("directions", sql.NVarChar, segment.directions ?? null);
        segmentReq.input("sort_order", sql.Int, segment.sort_order ?? index);
        await segmentReq.query(`INSERT INTO DetourIntakeSegments (intake_id, routes, directions, sort_order)
          VALUES (@intake_id, @routes, @directions, @sort_order)`);
      }
      return { status: 201, jsonBody: intake };
    } catch (err) {
      context.error("POST /detour-intake failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourIntakeReview", {
  route: "detour-intake/{id}",
  methods: ["PATCH"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = await parseJson(request); } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    if (!INTAKE_STATUSES.includes(body.status as IntakeStatus) || body.status === "accepted") {
      return { status: 400, jsonBody: { error: "status must be rejected or duplicate" } };
    }
    if (body.decision_notes !== undefined && typeof body.decision_notes !== "string") {
      return { status: 400, jsonBody: { error: "decision_notes must be a string if provided" } };
    }
    try {
      const pool = await getPool();
      const req = pool.request();
      req.input("id", sql.UniqueIdentifier, id);
      req.input("status", sql.NVarChar(20), body.status);
      req.input("decision_notes", sql.NVarChar(1000), body.decision_notes ?? null);
      req.input("reviewed_by", sql.NVarChar(200), auth.principal.userDetails || "system");
      const result = await req.query(`
        UPDATE DetourIntake
        SET status = @status, decision_notes = @decision_notes,
            reviewed_by = @reviewed_by, reviewed_at = SYSUTCDATETIME(),
            updated_by = @reviewed_by, updated_at = SYSUTCDATETIME()
        WHERE id = @id AND status = 'pending_review'
      `);
      if (!result.rowsAffected[0]) return { status: 404, jsonBody: { error: "Pending intake not found" } };
      return { status: 200, jsonBody: { id, status: body.status } };
    } catch (err) {
      context.error("PATCH /detour-intake/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourIntakePromote", {
  route: "detour-intake/{id}/promote",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = await parseJson(request); } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validatePromoteDetourIntake(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    const fulfillmentMode = body.fulfillment_mode as DetourFulfillmentMode;
    const lifecycleState = fulfillmentMode === "avail" ? "pending_avail_build" : "active";
    try {
      const pool = await getPool();
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const intakeReq = new sql.Request(tx);
        intakeReq.input("id", sql.UniqueIdentifier, id);
        const intakeResult = await intakeReq.query(`SELECT * FROM DetourIntake WHERE id = @id AND status = 'pending_review'`);
        const intake = intakeResult.recordset[0];
        if (!intake) { await tx.rollback(); return { status: 404, jsonBody: { error: "Pending intake not found" } }; }
        const internalNumber = await allocateDetourNumber(
          tx,
          detourNumberYear(body.start_date as string | null ?? intake.proposed_start_date, new Date()),
        );
        const detourReq = new sql.Request(tx);
        detourReq.input("closure", sql.NVarChar(500), intake.description);
        detourReq.input("riders_directed", sql.NVarChar(500), intake.location ?? null);
        detourReq.input("start_date", sql.Date, body.start_date ?? intake.proposed_start_date ?? null);
        detourReq.input("end_date", sql.Date, body.end_date ?? intake.proposed_end_date ?? null);
        detourReq.input("fulfillment_mode", sql.NVarChar(30), fulfillmentMode);
        detourReq.input("lifecycle_state", sql.NVarChar(30), lifecycleState);
        detourReq.input("workflow_owner", sql.NVarChar(200), auth.principal.userDetails || "system");
        detourReq.input("created_by", sql.NVarChar(200), auth.principal.userDetails || "system");
        detourReq.input("internal_number", sql.NVarChar(50), internalNumber);
        const detourResult = await detourReq.query<{ id: string; created_at: Date }>(`
          INSERT INTO Detours
            (internal_number, closure, start_date, end_date, riders_directed, source, fulfillment_mode,
             lifecycle_state, workflow_owner, workflow_updated_by, workflow_updated_at, created_by)
          OUTPUT INSERTED.id, INSERTED.created_at
          VALUES (@internal_number, @closure, @start_date, @end_date, @riders_directed, 'manual', @fulfillment_mode,
                  @lifecycle_state, @workflow_owner, @workflow_owner, SYSUTCDATETIME(), @created_by)
        `);
        const detour = detourResult.recordset[0];
        const segmentsReq = new sql.Request(tx);
        segmentsReq.input("intake_id", sql.UniqueIdentifier, id);
        const segments = await segmentsReq.query(`SELECT routes, directions, sort_order FROM DetourIntakeSegments WHERE intake_id = @intake_id`);
        for (const segment of segments.recordset) {
          const segmentReq = new sql.Request(tx);
          segmentReq.input("detour_id", sql.UniqueIdentifier, detour.id);
          segmentReq.input("routes", sql.NVarChar(200), segment.routes);
          segmentReq.input("directions", sql.NVarChar, segment.directions);
          segmentReq.input("sort_order", sql.Int, segment.sort_order);
          await segmentReq.query(`INSERT INTO DetourSegments (detour_id, routes, directions, sort_order)
            VALUES (@detour_id, @routes, @directions, @sort_order)`);
        }
        const promoteReq = new sql.Request(tx);
        promoteReq.input("id", sql.UniqueIdentifier, id);
        promoteReq.input("detour_id", sql.UniqueIdentifier, detour.id);
        promoteReq.input("reviewed_by", sql.NVarChar(200), auth.principal.userDetails || "system");
        await promoteReq.query(`UPDATE DetourIntake SET status = 'accepted', promoted_detour_id = @detour_id,
          reviewed_by = @reviewed_by, reviewed_at = SYSUTCDATETIME(), updated_by = @reviewed_by,
          updated_at = SYSUTCDATETIME() WHERE id = @id`);
        await tx.commit();
        return { status: 201, jsonBody: { id: detour.id, created_at: detour.created_at, lifecycle_state: lifecycleState } };
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    } catch (err) {
      context.error("POST /detour-intake/{id}/promote failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
