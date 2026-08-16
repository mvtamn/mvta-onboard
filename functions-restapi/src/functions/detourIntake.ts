import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_READ_ROLES, DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid, validateCreateDetourIntake, validatePromoteDetourIntake, validateReviewDetourIntake } from "../lib/validation";
import { toDateOnly } from "../lib/detourStatus";
import { detourNumberYear } from "../lib/detourNumbering";
import { allocateDetourNumber } from "../lib/detourNumberAllocator";
import type { DetourFulfillmentMode } from "../lib/types";

const INTAKE_STATUSES = ["pending_review", "accepted", "rejected", "duplicate"] as const;
type IntakeStatus = (typeof INTAKE_STATUSES)[number];

function parseJson(request: HttpRequest): Promise<Record<string, unknown>> {
  return request.json() as Promise<Record<string, unknown>>;
}

function parseStringList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
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
      const schema = await pool.request().query<{ duplicate_links_ready: number; complete_fields_ready: number }>(`
        SELECT CASE WHEN COL_LENGTH('dbo.DetourIntake', 'duplicate_of_intake_id') IS NULL
                         OR COL_LENGTH('dbo.DetourIntake', 'duplicate_of_detour_id') IS NULL
                    THEN 0 ELSE 1 END AS duplicate_links_ready,
               CASE WHEN COL_LENGTH('dbo.DetourIntake', 'service_impact') IS NULL
                          OR COL_LENGTH('dbo.DetourIntake', 'action_instructions') IS NULL
                    THEN 0 ELSE 1 END AS complete_fields_ready
      `);
      const duplicateLinksReady = schema.recordset[0]?.duplicate_links_ready === 1;
      const completeFieldsReady = schema.recordset[0]?.complete_fields_ready === 1;
      const result = await req.query(`
        SELECT i.id, i.detection_source, i.description, i.location,
               i.proposed_start_date, i.proposed_end_date, i.status,
               i.decision_notes, i.reviewed_by, i.reviewed_at,
               i.promoted_detour_id
               ${duplicateLinksReady ? ", i.duplicate_of_intake_id, i.duplicate_of_detour_id" : ""},
               i.created_by, i.created_at
               ${completeFieldsReady ? ", i.service_impact, i.service_area, i.action_instructions, i.proposed_fulfillment_mode, i.notification_audiences, i.notification_channels, i.evidence_notes, i.evidence_reference" : ""},
               i.updated_by, i.updated_at
        FROM DetourIntake i ${where}
        ORDER BY i.created_at DESC
      `);
      const segments = await pool.request().query(`
        SELECT s.id, s.intake_id, s.routes, s.directions, s.sort_order
        FROM DetourIntakeSegments s
        JOIN DetourIntake i ON i.id = s.intake_id
        ${where ? "WHERE i.status = @status" : ""}
        ORDER BY s.intake_id, s.sort_order
      `);
      const segmentsByIntake = new Map<string, unknown[]>();
      for (const segment of segments.recordset) {
        const list = segmentsByIntake.get(segment.intake_id) ?? [];
        list.push(segment);
        segmentsByIntake.set(segment.intake_id, list);
      }
      return {
        status: 200,
        jsonBody: {
          intake: result.recordset.map((row) => ({
            ...row,
            proposed_start_date: toDateOnly(row.proposed_start_date),
            proposed_end_date: toDateOnly(row.proposed_end_date),
            notification_audiences: parseStringList(row.notification_audiences),
            notification_channels: parseStringList(row.notification_channels),
            segments: segmentsByIntake.get(row.id) ?? [],
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
      req.input("service_impact", sql.NVarChar(20), body.service_impact);
      req.input("service_area", sql.NVarChar(500), body.service_area ?? null);
      req.input("action_instructions", sql.NVarChar(2000), body.action_instructions);
      req.input("proposed_fulfillment_mode", sql.NVarChar(30), body.proposed_fulfillment_mode);
      req.input("notification_audiences", sql.NVarChar(1000), JSON.stringify(body.notification_audiences));
      req.input("notification_channels", sql.NVarChar(1000), JSON.stringify(body.notification_channels));
      req.input("evidence_notes", sql.NVarChar(2000), body.evidence_notes ?? null);
      req.input("evidence_reference", sql.NVarChar(1000), body.evidence_reference ?? null);
      req.input("created_by", sql.NVarChar(200), auth.principal.userDetails || "system");
      const inserted = await req.query<{ id: string; created_at: Date }>(`
        INSERT INTO DetourIntake
          (detection_source, description, location, proposed_start_date, proposed_end_date,
           service_impact, service_area, action_instructions, proposed_fulfillment_mode,
           notification_audiences, notification_channels, evidence_notes, evidence_reference, created_by)
        OUTPUT INSERTED.id, INSERTED.created_at
        VALUES (@detection_source, @description, @location, @proposed_start_date, @proposed_end_date,
                @service_impact, @service_area, @action_instructions, @proposed_fulfillment_mode,
                @notification_audiences, @notification_channels, @evidence_notes, @evidence_reference, @created_by)
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
    const errors = validateReviewDetourIntake(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    try {
      const pool = await getPool();
      const schema = await pool.request().query<{ duplicate_links_ready: number }>(`
        SELECT CASE WHEN COL_LENGTH('dbo.DetourIntake', 'duplicate_of_intake_id') IS NULL
                         OR COL_LENGTH('dbo.DetourIntake', 'duplicate_of_detour_id') IS NULL
                    THEN 0 ELSE 1 END AS duplicate_links_ready
      `);
      const duplicateLinksReady = schema.recordset[0]?.duplicate_links_ready === 1;
      if (body.status === "duplicate" && !duplicateLinksReady) {
        return { status: 503, jsonBody: { error: "Duplicate links are not configured" } };
      }
      const req = pool.request();
      req.input("id", sql.UniqueIdentifier, id);
      req.input("status", sql.NVarChar(20), body.status);
      req.input("decision_notes", sql.NVarChar(1000), body.decision_notes ?? null);
      if (duplicateLinksReady) {
        req.input("duplicate_of_intake_id", sql.UniqueIdentifier, body.duplicate_of_intake_id ?? null);
        req.input("duplicate_of_detour_id", sql.UniqueIdentifier, body.duplicate_of_detour_id ?? null);
      }
      req.input("reviewed_by", sql.NVarChar(200), auth.principal.userDetails || "system");
      const result = await req.query(`
        UPDATE DetourIntake
        SET status = @status, decision_notes = @decision_notes
            ${duplicateLinksReady ? ", duplicate_of_intake_id = @duplicate_of_intake_id, duplicate_of_detour_id = @duplicate_of_detour_id" : ""},
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
    const lifecycleState = fulfillmentMode === "avail" ? "awaiting_fulfillment" : "fulfilled";
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
        const historyReq = new sql.Request(tx);
        historyReq.input("detour_id", sql.UniqueIdentifier, detour.id);
        historyReq.input("event_type", sql.NVarChar(30), "state_transition");
        historyReq.input("to_state", sql.NVarChar(30), lifecycleState);
        historyReq.input("source", sql.NVarChar(20), "manual");
        historyReq.input("detail", sql.NVarChar(1000), "Promoted from Detour Intake");
        historyReq.input("changed_by", sql.NVarChar(200), auth.principal.userDetails || "system");
        await historyReq.query(`
          INSERT INTO DetourWorkflowHistory
            (detour_id, event_type, to_state, source, detail, changed_by)
          VALUES (@detour_id, @event_type, @to_state, @source, @detail, @changed_by)
        `);
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
