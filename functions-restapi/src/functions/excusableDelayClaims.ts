import { randomUUID } from "node:crypto";
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { auditSql } from "../lib/assessment/audit";
import { materialChangeSql } from "../lib/assessment/materialChange";
import { isLateNotice } from "../lib/assessment/relief";
import { COMPLIANCE_MANAGER_ROLES, COMPLIANCE_READ_ROLES, COMPLIANCE_WRITE_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isGuid, isServiceMonth } from "../lib/validation";

// Attachment G's excusable-delay provision. A claim is filed against a
// contractor-month with the event and when notice arrived; the Issuing
// Authority approves or denies it. An approved claim linked from an
// occurrence removes that occurrence from the Assessable Input (assess.ts);
// a decision on a month already shared is a Material Assessment Change.
const withLate = <T extends { event_started_at: Date; notice_received_at: Date }>(row: T) => ({ ...row, late_notice: isLateNotice(row.event_started_at, row.notice_received_at) });

app.http("excusableDelayClaimsList", {
  route: "excusable-delay-claims", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const contractor = request.query.get("contractor_id"), month = request.query.get("service_month");
    if (!isGuid(contractor) || !isServiceMonth(month)) return { status: 400, jsonBody: { error: "contractor_id and service_month are required" } };
    try {
      const pool = await getPool(); const req = pool.request();
      req.input("contractor", sql.UniqueIdentifier, contractor); req.input("month", sql.Char(6), month);
      const result = await req.query<{ event_started_at: Date; notice_received_at: Date }>(`SELECT * FROM ExcusableDelayClaims WHERE contractor_id=@contractor AND service_month=@month ORDER BY created_at DESC`);
      return { status: 200, jsonBody: { claims: result.recordset.map(withLate) } };
    } catch (error) { context.error("GET excusable-delay claims failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

app.http("excusableDelayClaimsCreate", {
  route: "excusable-delay-claims", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const started = new Date(String(body.event_started_at)), notice = new Date(String(body.notice_received_at));
    if (!isGuid(body.contractor_id) || !isServiceMonth(body.service_month) || typeof body.event_description !== "string" || !body.event_description.trim() || Number.isNaN(started.getTime()) || Number.isNaN(notice.getTime()) || notice < started)
      return { status: 400, jsonBody: { error: "contractor_id, service_month, event_description, event_started_at, and a notice_received_at no earlier than the event are required" } };
    try {
      const pool = await getPool(); const req = pool.request(); const id = randomUUID();
      req.input("id", sql.UniqueIdentifier, id); req.input("contractor", sql.UniqueIdentifier, body.contractor_id); req.input("month", sql.Char(6), body.service_month);
      req.input("event", sql.NVarChar(2000), body.event_description); req.input("started", sql.DateTime2, started); req.input("notice", sql.DateTime2, notice);
      req.input("doc", sql.NVarChar(2000), typeof body.documentation_note === "string" ? body.documentation_note : null); req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      await req.query(`INSERT ExcusableDelayClaims(id,contractor_id,service_month,event_description,event_started_at,notice_received_at,documentation_note,status,created_by) VALUES(@id,@contractor,@month,@event,@started,@notice,@doc,'submitted',@actor);${auditSql("claim", "@id", "claim_filed", "actor", { after: "(SELECT @month service_month,@started event_started_at,@notice notice_received_at FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)" })}`);
      return { status: 201, jsonBody: { id, late_notice: isLateNotice(started, notice) } };
    } catch (error) { context.error("POST excusable-delay claim failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

app.http("excusableDelayClaimDecide", {
  route: "excusable-delay-claims/{id}/decision", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_MANAGER_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid claim id" } };
    let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    if (!["approved", "denied"].includes(String(body.status)) || typeof body.decision_note !== "string" || !body.decision_note.trim()) return { status: 400, jsonBody: { error: "status (approved or denied) and decision_note are required" } };
    const pool = await getPool(); const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const actor = auth.principal.userDetails ?? "onboard-console";
      const read = new sql.Request(tx); read.input("id", sql.UniqueIdentifier, request.params.id);
      const claim = (await read.query<{ status: string; event_started_at: Date; notice_received_at: Date; contractor_id: string; service_month: string }>(`SELECT status,event_started_at,notice_received_at,contractor_id,service_month FROM ExcusableDelayClaims WITH (UPDLOCK,HOLDLOCK) WHERE id=@id`)).recordset[0];
      if (!claim) { await tx.rollback(); return { status: 404, jsonBody: { error: "Claim not found" } }; }
      if (claim.status !== "submitted") { await tx.rollback(); return { status: 409, jsonBody: { error: "Only a submitted claim can be decided" } }; }
      // Late notice disqualifies relief (Attachment G). Approving anyway is a
      // recorded exception, not a click: it needs its own reason, kept with
      // the decision so the report and a dispute can see it.
      const late = isLateNotice(claim.event_started_at, claim.notice_received_at);
      const override = typeof body.late_notice_override === "string" ? body.late_notice_override.trim() : "";
      if (body.status === "approved" && late && !override) { await tx.rollback(); return { status: 409, jsonBody: { error: "Notice arrived more than 24 hours after the event; approving needs a late_notice_override reason" } }; }
      const note = late && override ? `${body.decision_note} (late notice accepted: ${override})` : String(body.decision_note);
      const write = new sql.Request(tx);
      write.input("id", sql.UniqueIdentifier, request.params.id); write.input("status", sql.NVarChar(20), body.status); write.input("note", sql.NVarChar(1000), note); write.input("actor", sql.NVarChar(200), actor);
      await write.query(`UPDATE ExcusableDelayClaims SET status=@status,decision_note=@note,decided_by=@actor,decided_at=SYSUTCDATETIME() WHERE id=@id;${auditSql("claim", "@id", "claim_decided", "actor", { after: "(SELECT @status status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)", note: "@note" })}`);
      // The decision changes the Assessable Input of every open period for
      // that contractor-month - a reopened original and its correction period
      // share the month - and each one that was shared is a Material
      // Assessment Change.
      const periods = new sql.Request(tx); periods.input("contractor", sql.UniqueIdentifier, claim.contractor_id); periods.input("month", sql.Char(6), claim.service_month);
      const open = (await periods.query<{ id: string }>(`SELECT id FROM AssessmentPeriods WHERE contractor_id=@contractor AND service_month=@month AND status<>'issued'`)).recordset;
      for (const period of open) { const change = new sql.Request(tx); change.input("period", sql.UniqueIdentifier, period.id); change.input("actor", sql.NVarChar(200), actor); await change.query(materialChangeSql("period", "actor")); }
      await tx.commit();
      return { status: 200, jsonBody: { id: request.params.id, status: body.status, late_notice: late } };
    } catch (error) { try { await tx.rollback(); } catch { /* completed */ } context.error("POST excusable-delay claim decision failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
