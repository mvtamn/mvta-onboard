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
      const pool = await getPool(); const req = pool.request(); const id = crypto.randomUUID();
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
    try {
      const pool = await getPool(); const req = pool.request();
      req.input("id", sql.UniqueIdentifier, request.params.id); req.input("status", sql.NVarChar(20), body.status); req.input("note", sql.NVarChar(1000), body.decision_note); req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      // The decision changes the Assessable Input of every open period for
      // that contractor-month (a correction period and its original share
      // the month); each one that was shared is a Material Assessment Change.
      const result = await req.query<{ changed: number }>(`
        UPDATE ExcusableDelayClaims SET status=@status,decision_note=@note,decided_by=@actor,decided_at=SYSUTCDATETIME() WHERE id=@id AND status='submitted';
        DECLARE @changed INT=@@ROWCOUNT;
        IF @changed=1 BEGIN
          ${auditSql("claim", "@id", "claim_decided", "actor", { after: "(SELECT @status status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)", note: "@note" })}
          DECLARE @period UNIQUEIDENTIFIER=(SELECT TOP 1 p.id FROM AssessmentPeriods p JOIN ExcusableDelayClaims c ON c.contractor_id=p.contractor_id AND c.service_month=p.service_month WHERE c.id=@id AND p.status<>'issued' ORDER BY p.assessment_revision DESC);
          IF @period IS NOT NULL BEGIN ${materialChangeSql("period", "actor")} END
        END
        SELECT @changed changed;`);
      if (!result.recordset[0]?.changed) return { status: 409, jsonBody: { error: "Only a submitted claim can be decided" } };
      return { status: 200, jsonBody: { id: request.params.id, status: body.status } };
    } catch (error) { context.error("POST excusable-delay claim decision failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
