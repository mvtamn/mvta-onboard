import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_INTAKE_ROLES, requireRole } from "../lib/auth";
import { isGuid, validateCreateDetourIntake, validatePromoteDetourIntake, validateReviewDetourIntake } from "../lib/validation";
import { toDateOnly, toTimeOnly } from "../lib/detourStatus";
import { detourNumberYear } from "../lib/detourNumbering";
import { allocateDetourNumber } from "../lib/detourNumberAllocator";
import type { DetourFulfillmentMode } from "../lib/types";
import { intakeReviewRefusal, intakeStatusAfterUpdate, isOpenIntakeStatus, type DetourIntakeStatus, type DetourIntakeReviewOutcome } from "../lib/detourIntakeTransitions";
import { findLikelyDuplicates, type DuplicateCandidate } from "../lib/detourDuplicates";
import { detourIntakeSelectColumns } from "../lib/detourIntakeColumns";
import { toDateOnly as dateOnly } from "../lib/detourStatus";

const INTAKE_STATUSES = ["pending_review", "needs_information", "accepted", "rejected", "duplicate", "withdrawn"] as const;
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
    const auth = requireRole(request, DETOUR_INTAKE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const status = request.query.get("status");
      const pool = await getPool();
      const req = pool.request();
      const where = INTAKE_STATUSES.includes(status as IntakeStatus) ? "WHERE i.status = @status" : "";
      if (where) req.input("status", sql.NVarChar(20), status);
      const schema = await pool.request().query<{ duplicate_links_ready: number; complete_fields_ready: number; operational_fields_ready: number; detour_location_ready: number; geometry_ready: number }>(`
        SELECT CASE WHEN COL_LENGTH('dbo.Detours', 'location') IS NULL THEN 0 ELSE 1 END AS detour_location_ready,
               CASE WHEN COL_LENGTH('dbo.DetourIntake', 'geometry_json') IS NULL OR COL_LENGTH('dbo.Detours', 'geometry_json') IS NULL THEN 0 ELSE 1 END AS geometry_ready,
               CASE WHEN COL_LENGTH('dbo.DetourIntake', 'duplicate_of_intake_id') IS NULL
                         OR COL_LENGTH('dbo.DetourIntake', 'duplicate_of_detour_id') IS NULL
                    THEN 0 ELSE 1 END AS duplicate_links_ready,
               CASE WHEN COL_LENGTH('dbo.DetourIntake', 'service_impact') IS NULL
                          OR COL_LENGTH('dbo.DetourIntake', 'action_instructions') IS NULL
                    THEN 0 ELSE 1 END AS complete_fields_ready,
               CASE WHEN COL_LENGTH('dbo.DetourIntake', 'time_window_status') IS NULL
                          OR COL_LENGTH('dbo.DetourIntake', 'affected_stops_and_stations') IS NULL
                    THEN 0 ELSE 1 END AS operational_fields_ready
      `);
      const duplicateLinksReady = schema.recordset[0]?.duplicate_links_ready === 1;
      const completeFieldsReady = schema.recordset[0]?.complete_fields_ready === 1;
      const operationalFieldsReady = schema.recordset[0]?.operational_fields_ready === 1;
      const detourLocationReady = schema.recordset[0]?.detour_location_ready === 1;
      const geometryReady = schema.recordset[0]?.geometry_ready === 1;
      const result = await req.query(`
        SELECT ${detourIntakeSelectColumns({ duplicateLinksReady, completeFieldsReady, operationalFieldsReady, geometryReady })}
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
      const segmentsByIntake = new Map<string, Array<{ routes: string; directions: string | null }>>();
      for (const segment of segments.recordset) {
        const list = segmentsByIntake.get(segment.intake_id) ?? [];
        list.push(segment);
        segmentsByIntake.set(segment.intake_id, list);
      }
      const intake = result.recordset.map((row) => ({
        ...row,
        proposed_start_date: toDateOnly(row.proposed_start_date),
        proposed_end_date: toDateOnly(row.proposed_end_date),
        proposed_start_time: toTimeOnly(row.proposed_start_time),
        proposed_end_time: toTimeOnly(row.proposed_end_time),
        notification_audiences: parseStringList(row.notification_audiences),
        notification_channels: parseStringList(row.notification_channels),
        segments: segmentsByIntake.get(row.id) ?? [],
      }));

      // Likely duplicates for every open intake in the response, against
      // every non-deleted, non-closed Detour and every other open intake.
      // Only the open ones need it - a decided intake is not being reviewed.
      // Computed here rather than per row so the queue shows the warning
      // before the reviewer picks an action, at the cost of one extra
      // Detours read per list call.
      const openIntake = intake.filter((row) => isOpenIntakeStatus(row.status));
      let likelyDuplicatesById = new Map<string, ReturnType<typeof findLikelyDuplicates>>();
      if (openIntake.length > 0) {
        const detourRows = await pool.request().query<{ id: string; internal_number: string | null; number: string | null; closure: string; location: string | null; service_area: string | null; start_date: Date | null; end_date: Date | null; lifecycle_state: string | null; segment_routes: string | null }>(`
          SELECT d.id, ${completeFieldsReady ? "d.internal_number" : "NULL AS internal_number"}, d.number, d.closure,
                 ${detourLocationReady ? "d.location" : "NULL AS location"}, ${completeFieldsReady ? "d.service_area" : "NULL AS service_area"},
                 d.start_date, d.end_date, ${completeFieldsReady ? "d.lifecycle_state" : "NULL AS lifecycle_state"},
                 (SELECT STRING_AGG(s.routes, '; ') FROM DetourSegments s WHERE s.detour_id = d.id) AS segment_routes
          FROM Detours d
          WHERE d.is_deleted = 0 ${completeFieldsReady ? "AND (d.lifecycle_state IS NULL OR d.lifecycle_state <> 'closed')" : ""}
        `);
        const candidates: DuplicateCandidate[] = [
          ...detourRows.recordset.map((d) => ({
            kind: "detour" as const, id: d.id, label: d.internal_number || d.number || d.closure, status: d.lifecycle_state ?? "recorded",
            place_text: [d.closure, d.location].filter(Boolean).join(" "),
            route_texts: [d.segment_routes, d.service_area].filter((v): v is string => Boolean(v)),
            start_date: dateOnly(d.start_date), end_date: dateOnly(d.end_date),
          })),
          ...openIntake.map((row) => ({
            kind: "intake" as const, id: row.id, label: row.description, status: row.status,
            place_text: [row.description, row.location].filter(Boolean).join(" "),
            route_texts: [...row.segments.map((s: { routes: string }) => s.routes), row.service_area].filter((v): v is string => Boolean(v)),
            start_date: row.proposed_start_date, end_date: row.proposed_end_date,
          })),
        ];
        likelyDuplicatesById = new Map(openIntake.map((row) => [row.id, findLikelyDuplicates({
          id: row.id,
          place_text: [row.description, row.location].filter(Boolean).join(" "),
          route_texts: [...row.segments.map((s: { routes: string }) => s.routes), row.service_area].filter((v): v is string => Boolean(v)),
          start_date: row.proposed_start_date, end_date: row.proposed_end_date,
        }, candidates)]));
      }
      return {
        status: 200,
        jsonBody: {
          intake: intake.map((row) => ({ ...row, likely_duplicates: likelyDuplicatesById.get(row.id) ?? [] })),
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
    const auth = requireRole(request, DETOUR_INTAKE_ROLES);
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
      req.input("proposed_start_time", sql.Time, body.proposed_start_time ?? null);
      req.input("proposed_end_time", sql.Time, body.proposed_end_time ?? null);
      req.input("time_window_status", sql.NVarChar(20), body.time_window_status);
      req.input("affected_stops_and_stations", sql.NVarChar(2000), body.affected_stops_and_stations ?? null);
      req.input("operational_impacts", sql.NVarChar(2000), body.operational_impacts ?? null);
      req.input("confirmation_contact", sql.NVarChar(500), body.confirmation_contact ?? null);
      req.input("service_impact", sql.NVarChar(20), body.service_impact);
      req.input("service_area", sql.NVarChar(500), body.service_area ?? null);
      req.input("action_instructions", sql.NVarChar(2000), body.action_instructions);
      req.input("proposed_fulfillment_mode", sql.NVarChar(30), body.proposed_fulfillment_mode);
      req.input("notification_audiences", sql.NVarChar(1000), JSON.stringify(body.notification_audiences));
      req.input("notification_channels", sql.NVarChar(1000), JSON.stringify(body.notification_channels));
      req.input("evidence_notes", sql.NVarChar(2000), body.evidence_notes ?? null);
      req.input("evidence_reference", sql.NVarChar(1000), body.evidence_reference ?? null);
      req.input("created_by", sql.NVarChar(200), auth.principal.userDetails || "system");
      const geometryReady = (await pool.request().query<{ ready: number }>("SELECT CASE WHEN COL_LENGTH('dbo.DetourIntake', 'geometry_json') IS NULL THEN 0 ELSE 1 END AS ready")).recordset[0]?.ready === 1;
      req.input("geometry_json", sql.NVarChar(sql.MAX), body.geometry_json ?? null);
      const inserted = await req.query<{ id: string; created_at: Date }>(`
        INSERT INTO DetourIntake
          (detection_source, description, location, proposed_start_date, proposed_end_date, proposed_start_time, proposed_end_time, time_window_status, affected_stops_and_stations, operational_impacts, confirmation_contact,
           service_impact, service_area, action_instructions, proposed_fulfillment_mode,
           notification_audiences, notification_channels, evidence_notes, evidence_reference, created_by${geometryReady ? ", geometry_json" : ""})
        OUTPUT INSERTED.id, INSERTED.created_at
        VALUES (@detection_source, @description, @location, @proposed_start_date, @proposed_end_date, @proposed_start_time, @proposed_end_time, @time_window_status, @affected_stops_and_stations, @operational_impacts, @confirmation_contact,
                @service_impact, @service_area, @action_instructions, @proposed_fulfillment_mode,
                @notification_audiences, @notification_channels, @evidence_notes, @evidence_reference, @created_by${geometryReady ? ", @geometry_json" : ""})
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
    const auth = requireRole(request, DETOUR_INTAKE_ROLES);
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
      const currentReq = pool.request();
      currentReq.input("id", sql.UniqueIdentifier, id);
      const current = (await currentReq.query<{ status: DetourIntakeStatus }>("SELECT status FROM DetourIntake WHERE id = @id")).recordset[0];
      if (!current) return { status: 404, jsonBody: { error: "Intake not found" } };
      const refusal = intakeReviewRefusal(current.status, body.status as DetourIntakeReviewOutcome);
      if (refusal) return { status: 409, jsonBody: { error: refusal } };
      const req = pool.request();
      req.input("id", sql.UniqueIdentifier, id);
      req.input("current_status", sql.NVarChar(20), current.status);
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
        WHERE id = @id AND status = @current_status
      `);
      if (!result.rowsAffected[0]) return { status: 409, jsonBody: { error: "Intake changed while the decision was being saved; reload and try again" } };
      return { status: 200, jsonBody: { id, status: body.status } };
    } catch (err) {
      context.error("PATCH /detour-intake/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});


// Full-record update of an open intake. Same contract as create, so the
// console's form submits identically for a new report and a correction.
// An intake returned for information goes back to the review queue on
// save: the update IS the resubmission. The reviewer's decision_notes are
// kept so the queue shows what was asked for alongside what came back.
app.http("detourIntakeUpdate", {
  route: "detour-intake/{id}",
  methods: ["PUT"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_INTAKE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = await parseJson(request); } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validateCreateDetourIntake(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    try {
      const pool = await getPool();
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const currentReq = new sql.Request(tx);
        currentReq.input("id", sql.UniqueIdentifier, id);
        const current = (await currentReq.query<{ status: DetourIntakeStatus }>("SELECT status FROM DetourIntake WHERE id = @id")).recordset[0];
        if (!current) { await tx.rollback(); return { status: 404, jsonBody: { error: "Intake not found" } }; }
        const nextStatus = intakeStatusAfterUpdate(current.status);
        if (!nextStatus) { await tx.rollback(); return { status: 409, jsonBody: { error: `Intake is already ${current.status.replace("_", " ")} and can no longer be edited` } }; }
        const req = new sql.Request(tx);
        req.input("id", sql.UniqueIdentifier, id);
        req.input("status", sql.NVarChar(20), nextStatus);
        req.input("detection_source", sql.NVarChar(100), body.detection_source);
        req.input("description", sql.NVarChar(1000), body.description);
        req.input("location", sql.NVarChar(500), body.location ?? null);
        req.input("proposed_start_date", sql.Date, body.proposed_start_date ?? null);
        req.input("proposed_end_date", sql.Date, body.proposed_end_date ?? null);
        req.input("proposed_start_time", sql.Time, body.proposed_start_time ?? null);
        req.input("proposed_end_time", sql.Time, body.proposed_end_time ?? null);
        req.input("time_window_status", sql.NVarChar(20), body.time_window_status);
        req.input("affected_stops_and_stations", sql.NVarChar(2000), body.affected_stops_and_stations ?? null);
        req.input("operational_impacts", sql.NVarChar(2000), body.operational_impacts ?? null);
        req.input("confirmation_contact", sql.NVarChar(500), body.confirmation_contact ?? null);
        req.input("service_impact", sql.NVarChar(20), body.service_impact);
        req.input("service_area", sql.NVarChar(500), body.service_area ?? null);
        req.input("action_instructions", sql.NVarChar(2000), body.action_instructions);
        req.input("proposed_fulfillment_mode", sql.NVarChar(30), body.proposed_fulfillment_mode);
        req.input("notification_audiences", sql.NVarChar(1000), JSON.stringify(body.notification_audiences));
        req.input("notification_channels", sql.NVarChar(1000), JSON.stringify(body.notification_channels));
        req.input("evidence_notes", sql.NVarChar(2000), body.evidence_notes ?? null);
        req.input("evidence_reference", sql.NVarChar(1000), body.evidence_reference ?? null);
        req.input("updated_by", sql.NVarChar(200), auth.principal.userDetails || "system");
        const geometryReady = (await new sql.Request(tx).query<{ ready: number }>("SELECT CASE WHEN COL_LENGTH('dbo.DetourIntake', 'geometry_json') IS NULL THEN 0 ELSE 1 END AS ready")).recordset[0]?.ready === 1;
        req.input("geometry_json", sql.NVarChar(sql.MAX), body.geometry_json ?? null);
        await req.query(`
          UPDATE DetourIntake SET${geometryReady ? " geometry_json = @geometry_json," : ""}
            status = @status, detection_source = @detection_source, description = @description, location = @location,
            proposed_start_date = @proposed_start_date, proposed_end_date = @proposed_end_date,
            proposed_start_time = @proposed_start_time, proposed_end_time = @proposed_end_time, time_window_status = @time_window_status,
            affected_stops_and_stations = @affected_stops_and_stations, operational_impacts = @operational_impacts, confirmation_contact = @confirmation_contact,
            service_impact = @service_impact, service_area = @service_area, action_instructions = @action_instructions,
            proposed_fulfillment_mode = @proposed_fulfillment_mode, notification_audiences = @notification_audiences, notification_channels = @notification_channels,
            evidence_notes = @evidence_notes, evidence_reference = @evidence_reference,
            updated_by = @updated_by, updated_at = SYSUTCDATETIME()
          WHERE id = @id
        `);
        const clearReq = new sql.Request(tx);
        clearReq.input("intake_id", sql.UniqueIdentifier, id);
        await clearReq.query("DELETE FROM DetourIntakeSegments WHERE intake_id = @intake_id");
        for (const [index, segment] of ((body.segments as Array<Record<string, unknown>> | undefined) ?? []).entries()) {
          const segmentReq = new sql.Request(tx);
          segmentReq.input("intake_id", sql.UniqueIdentifier, id);
          segmentReq.input("routes", sql.NVarChar(200), segment.routes);
          segmentReq.input("directions", sql.NVarChar, segment.directions ?? null);
          segmentReq.input("sort_order", sql.Int, segment.sort_order ?? index);
          await segmentReq.query(`INSERT INTO DetourIntakeSegments (intake_id, routes, directions, sort_order)
            VALUES (@intake_id, @routes, @directions, @sort_order)`);
        }
        await tx.commit();
        return { status: 200, jsonBody: { id, status: nextStatus, resubmitted: current.status === "needs_information" } };
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    } catch (err) {
      context.error("PUT /detour-intake/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourIntakePromote", {
  route: "detour-intake/{id}/promote",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_INTAKE_ROLES);
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
        detourReq.input("id", sql.UniqueIdentifier, id);
        detourReq.input("closure", sql.NVarChar(500), intake.description);
        // Location is where the closure is; riders_directed is where riders
        // go instead. Intake has no field for the latter, so it stays null
        // until staff record it on the Detour. Detours.location arrives
        // with migration 088; before it, the location is carried only in
        // the intake row.
        const locationReady = (await new sql.Request(tx).query<{ ready: number }>("SELECT CASE WHEN COL_LENGTH('dbo.Detours', 'location') IS NULL THEN 0 ELSE 1 END AS ready")).recordset[0]?.ready === 1;
        detourReq.input("riders_directed", sql.NVarChar(500), null);
        detourReq.input("location", sql.NVarChar(500), intake.location ?? null);
        const geometryReady = (await new sql.Request(tx).query<{ ready: number }>("SELECT CASE WHEN COL_LENGTH('dbo.DetourIntake', 'geometry_json') IS NULL OR COL_LENGTH('dbo.Detours', 'geometry_json') IS NULL THEN 0 ELSE 1 END AS ready")).recordset[0]?.ready === 1;
        detourReq.input("geometry_json", sql.NVarChar(sql.MAX), geometryReady ? intake.geometry_json ?? null : null);
        detourReq.input("start_date", sql.Date, body.start_date ?? intake.proposed_start_date ?? null);
        detourReq.input("end_date", sql.Date, body.end_date ?? intake.proposed_end_date ?? null);
        detourReq.input("start_time", sql.Time, intake.proposed_start_time ?? null);
        detourReq.input("end_time", sql.Time, intake.proposed_end_time ?? null);
        detourReq.input("time_window_status", sql.NVarChar(20), intake.time_window_status);
        detourReq.input("affected_stops_and_stations", sql.NVarChar(2000), intake.affected_stops_and_stations ?? null);
        detourReq.input("operational_impacts", sql.NVarChar(2000), intake.operational_impacts ?? null);
        detourReq.input("confirmation_contact", sql.NVarChar(500), intake.confirmation_contact ?? null);
        detourReq.input("fulfillment_mode", sql.NVarChar(30), fulfillmentMode);
        detourReq.input("lifecycle_state", sql.NVarChar(30), lifecycleState);
        detourReq.input("workflow_owner", sql.NVarChar(200), auth.principal.userDetails || "system");
        detourReq.input("created_by", sql.NVarChar(200), auth.principal.userDetails || "system");
        detourReq.input("internal_number", sql.NVarChar(50), internalNumber);
        detourReq.input("service_impact", sql.NVarChar(20), intake.service_impact);
        detourReq.input("service_area", sql.NVarChar(500), intake.service_area ?? null);
        detourReq.input("action_instructions", sql.NVarChar(2000), intake.action_instructions ?? null);
        detourReq.input("notification_audiences", sql.NVarChar(1000), intake.notification_audiences ?? null);
        detourReq.input("notification_channels", sql.NVarChar(1000), intake.notification_channels ?? null);
        detourReq.input("evidence_notes", sql.NVarChar(2000), intake.evidence_notes ?? null);
        detourReq.input("evidence_reference", sql.NVarChar(1000), intake.evidence_reference ?? null);
        const detourResult = await detourReq.query<{ id: string; created_at: Date }>(`
          INSERT INTO Detours
            (id, internal_number, closure, start_date, end_date, riders_directed, source, fulfillment_mode,
             lifecycle_state, workflow_owner, workflow_updated_by, workflow_updated_at, created_by,
             service_impact, service_area, action_instructions, notification_audiences,
             notification_channels, evidence_notes, evidence_reference, start_time, end_time, time_window_status,
             affected_stops_and_stations, operational_impacts, confirmation_contact${locationReady ? ", location" : ""}${geometryReady ? ", geometry_json" : ""})
          OUTPUT INSERTED.id, INSERTED.created_at
          VALUES (@id, @internal_number, @closure, @start_date, @end_date, @riders_directed, 'manual', @fulfillment_mode,
                  @lifecycle_state, @workflow_owner, @workflow_owner, SYSUTCDATETIME(), @created_by,
                  @service_impact, @service_area, @action_instructions, @notification_audiences,
                  @notification_channels, @evidence_notes, @evidence_reference, @start_time, @end_time, @time_window_status,
                  @affected_stops_and_stations, @operational_impacts, @confirmation_contact${locationReady ? ", @location" : ""}${geometryReady ? ", @geometry_json" : ""})
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
        const attachmentsReq = new sql.Request(tx);
        attachmentsReq.input("detour_id", sql.UniqueIdentifier, detour.id);
        attachmentsReq.input("intake_id", sql.UniqueIdentifier, id);
        await attachmentsReq.query("UPDATE DetourImages SET detour_id=@detour_id,intake_id=NULL WHERE intake_id=@intake_id");
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
        promoteReq.input("detour_id", sql.UniqueIdentifier, id);
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
