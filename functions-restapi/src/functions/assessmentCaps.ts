import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { auditSql } from "../lib/assessment/audit";
import { CAP_MANUAL_TRIGGERS, capTransition, type CapStatus } from "../lib/assessment/capTransitions";
import { addBusinessDays, assertHolidayCoverage } from "../lib/assessment/businessDays";
import { randomUUID } from "node:crypto";
import { COMPLIANCE_MANAGER_ROLES, COMPLIANCE_WRITE_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isGuid } from "../lib/validation";

const STATUSES: readonly CapStatus[] = ["required", "submitted", "approved", "in_progress", "closed", "failed", "withdrawn"];

// One transition per call. The rule set lives in lib/assessment/capTransitions;
// this handler binds the caller's role, reads the plan's current status under
// a lock, and writes the fields the step requires plus its timestamp.
app.http("assessmentCapTransition", {
  route: "assessment-caps/{id}", methods: ["PATCH"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid CAP id" } };
    let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const to = String(body.status) as CapStatus;
    if (!STATUSES.includes(to)) return { status: 400, jsonBody: { error: `status must be one of ${STATUSES.join(", ")}` } };
    const role = auth.principal.roles.some(r => COMPLIANCE_MANAGER_ROLES.includes(r)) ? "manager" : "writer";
    const actor = auth.principal.userDetails ?? "onboard-console";
    const pool = await getPool(); const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const read = new sql.Request(tx); read.input("id", sql.UniqueIdentifier, request.params.id);
      const current = (await read.query<{ status: CapStatus }>(`SELECT status FROM CorrectiveActionPlans WITH (UPDLOCK,HOLDLOCK) WHERE id=@id`)).recordset[0];
      if (!current) { await tx.rollback(); return { status: 404, jsonBody: { error: "Corrective Action Plan not found" } }; }
      const decision = capTransition(current.status, to, role, body);
      if (!decision.ok) { await tx.rollback(); return { status: 409, jsonBody: { error: decision.error } }; }
      const write = new sql.Request(tx);
      write.input("id", sql.UniqueIdentifier, request.params.id); write.input("to", sql.NVarChar(20), to); write.input("actor", sql.NVarChar(200), actor); write.input("from", sql.NVarChar(20), current.status);
      // Field names come from the rule table, never the body; values are bound.
      const assignments = decision.sets.map(f => { write.input(f, sql.NVarChar(sql.MAX), String(body[f])); return `${f}=@${f}`; });
      if (decision.stamps) assignments.push(`${decision.stamps}=SYSUTCDATETIME()`);
      if (decision.clears) assignments.push(`${decision.clears}=NULL`);
      write.input("note", sql.NVarChar(1000), decision.note ? String(body.note) : decision.sets.includes("closure_note") ? String(body.closure_note) : null);
      await write.query(`UPDATE CorrectiveActionPlans SET status=@to${assignments.length ? "," + assignments.join(",") : ""} WHERE id=@id;${auditSql("cap", "@id", "cap_transitioned", "actor", { after: "(SELECT @from [from],@to [to] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)", note: "@note" })}`);
      await tx.commit();
      return { status: 200, jsonBody: { id: request.params.id, status: to } };
    } catch (error) {
      try { await tx.rollback(); } catch { /* completed */ }
      context.error("PATCH assessment CAP failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});


// A manual CAP Determination (design §8): the Issuing Authority requires a
// plan on its own judgement or records one the contractor brought - against
// an issued month, so it can never stand in for the tier-rule plan issuance
// creates. Due five business days out, holiday-aware, failing closed.
app.http("assessmentCapCreate", {
  route: "assessment-caps", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_MANAGER_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    if (!isGuid(body.period_id) || !CAP_MANUAL_TRIGGERS.includes(body.trigger_reason as never) || typeof body.note !== "string" || !body.note.trim() || (body.standard_id !== undefined && body.standard_id !== null && !isGuid(body.standard_id)))
      return { status: 400, jsonBody: { error: `period_id, trigger_reason (${CAP_MANUAL_TRIGGERS.join(" or ")}), and a note are required; standard_id is optional` } };
    try {
      const pool = await getPool(); const now = new Date();
      const calendar = await pool.request().query<{ holiday_date: Date }>(`SELECT holiday_date FROM MvtaHolidays`);
      const coverage = await pool.request().query<{ coverage_through: Date }>(`SELECT coverage_through FROM MvtaHolidayCalendarCoverage WHERE id=1`);
      assertHolidayCoverage(now, new Date(now.getTime() + 14 * 86400000), coverage.recordset[0]?.coverage_through ?? null);
      const due = addBusinessDays(now, 5, new Set(calendar.recordset.map(r => r.holiday_date.toISOString().slice(0, 10))));
      const req = pool.request(); const id = randomUUID();
      req.input("id", sql.UniqueIdentifier, id); req.input("period", sql.UniqueIdentifier, body.period_id); req.input("standard", sql.UniqueIdentifier, isGuid(body.standard_id) ? body.standard_id : null); req.input("trigger", sql.NVarChar(40), body.trigger_reason); req.input("due", sql.DateTime2, due); req.input("note", sql.NVarChar(1000), body.note); req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      const result = await req.query<{ id: string }>(`IF EXISTS(SELECT 1 FROM AssessmentPeriods WHERE id=@period AND status='issued') AND (@standard IS NULL OR EXISTS(SELECT 1 FROM AssessmentPeriodStandards WHERE period_id=@period AND standard_id=@standard)) BEGIN INSERT CorrectiveActionPlans(id,contractor_id,standard_id,period_id,trigger_reason,due_at,created_by) SELECT @id,contractor_id,@standard,@period,@trigger,@due,@actor FROM AssessmentPeriods WHERE id=@period;${auditSql("cap", "@id", "cap_required", "actor", { after: "(SELECT @trigger trigger_reason,@due due_at FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)", note: "@note" })}SELECT @id id;END`);
      if (!result.recordset[0]) return { status: 409, jsonBody: { error: "A manual CAP is required against an issued Assessment Period and, if named, one of its scored standards" } };
      return { status: 201, jsonBody: { id, due_at: due.toISOString() } };
    } catch (error) { context.error("POST assessment CAP failed", error); return { status: 409, jsonBody: { error: error instanceof Error ? error.message : "Unable to require a plan" } }; }
  },
});
