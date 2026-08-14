import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { assessPeriod } from "../lib/assessment/assess";
import { COMPLIANCE_MANAGER_ROLES, COMPLIANCE_READ_ROLES, COMPLIANCE_WRITE_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isGuid, isServiceMonth } from "../lib/validation";

app.http("assessmentPeriodsList", {
  route: "assessment-periods", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      const check = await pool.request().query<{ ready: number }>(`SELECT CASE WHEN OBJECT_ID('dbo.AssessmentPeriods','U') IS NULL THEN 0 ELSE 1 END ready`);
      if (!check.recordset[0]?.ready) return { status: 200, jsonBody: { periods: [], diagnostics: { table_ready: false } } };
      const result = await pool.request().query(`SELECT p.*,c.name contractor_name FROM AssessmentPeriods p JOIN Contractors c ON c.id=p.contractor_id ORDER BY service_month DESC,c.name`);
      return { status: 200, jsonBody: { periods: result.recordset, diagnostics: { table_ready: true } } };
    } catch (error) { context.error("GET /assessment-periods failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

app.http("assessmentPeriodsOpen", {
  route: "assessment-periods", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    if (!isGuid(body.contractor_id) || !isServiceMonth(body.service_month)) return { status: 400, jsonBody: { error: "contractor_id and service_month are required" } };
    try {
      const pool = await getPool();
      const req = pool.request(); req.input("contractor", sql.UniqueIdentifier, body.contractor_id); req.input("month", sql.Char(6), body.service_month);
      const contractor = await req.query<{ id: string }>(`SELECT id FROM Contractors WHERE id=@contractor AND is_active=1`);
      if (!contractor.recordset[0]) return { status: 404, jsonBody: { error: "Active contractor not found" } };
      const write = pool.request(); write.input("contractor", sql.UniqueIdentifier, body.contractor_id); write.input("month", sql.Char(6), body.service_month);
      const result = await write.query<{ id: string }>(`
        IF NOT EXISTS(SELECT 1 FROM AssessmentPeriods WHERE contractor_id=@contractor AND service_month=@month)
          INSERT AssessmentPeriods(contractor_id,service_month,ramp_up_stage) VALUES(@contractor,@month,'full');
        SELECT id FROM AssessmentPeriods WHERE contractor_id=@contractor AND service_month=@month;
      `);
      return { status: 201, jsonBody: { id: result.recordset[0]?.id } };
    } catch (error) { context.error("POST /assessment-periods failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

app.http("assessmentPeriodCompute", {
  route: "assessment-periods/{id}/compute", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid period id" } };
    const pool = await getPool(); const tx = new sql.Transaction(pool);
    try { await tx.begin(); await assessPeriod(tx, request.params.id); await tx.commit(); return { status: 200, jsonBody: { id: request.params.id, status: "in_review" } }; }
    catch (error) { try { await tx.rollback(); } catch { /* completed */ } context.error("POST assessment compute failed", error); return { status: 409, jsonBody: { error: error instanceof Error ? error.message : "Assessment failed" } }; }
  },
});

app.http("assessmentPeriodFinalize", {
  route: "assessment-periods/{id}/finalize", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_MANAGER_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid period id" } };
    try {
      const pool = await getPool(); const req = pool.request(); req.input("id", sql.UniqueIdentifier, request.params.id); req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      const result = await req.query<{ changed: number }>(`
        UPDATE AssessmentPeriods SET status='finalized',final_total=(SELECT SUM(final_amount) FROM PeriodKpiAssessments WHERE period_id=@id),finalized_by=@actor,finalized_at=SYSUTCDATETIME()
        WHERE id=@id AND status='in_validation' AND validation_ends_on<=CONVERT(date,SYSUTCDATETIME()) AND computed_revision=input_revision
          AND EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id)
          AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id AND (manager_action='pending' OR reviewed_input_sha256<>input_sha256 OR (ISNULL(data_completeness_pct,0)<=0 AND assessment_outcome<>'not_assessable')))
          AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id AND reviewed_by=@actor)
          AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments a WHERE a.period_id=@id AND a.assessment_outcome='not_assessable' AND NOT EXISTS(SELECT 1 FROM AssessmentExceptions e WHERE e.assessment_id=a.id))
          AND NOT EXISTS(SELECT 1 FROM ComplianceOccurrences o JOIN AssessmentPeriods p ON p.contractor_id=o.contractor_id AND p.service_month=o.service_month WHERE p.id=@id AND o.review_status='candidate');
        DECLARE @changed INT=@@ROWCOUNT;
        IF @changed=1 UPDATE PeriodKpiAssessments SET binding_decision_by=@actor WHERE period_id=@id;
        SELECT @changed changed;
      `);
      if (!result.recordset[0]?.changed) return { status: 409, jsonBody: { error: "Period is stale, incomplete, or has pending KPI review" } };
      return { status: 200, jsonBody: { id: request.params.id, status: "finalized" } };
    } catch (error) { context.error("POST assessment finalize failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});

app.http("assessmentPeriodReopen", {
  route: "assessment-periods/{id}/reopen", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_MANAGER_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid period id" } };
    let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    if (typeof body.reason !== "string" || !body.reason.trim()) return { status: 400, jsonBody: { error: "reason is required" } };
    try {
      const pool = await getPool(); const req = pool.request(); req.input("id", sql.UniqueIdentifier, request.params.id); req.input("reason", sql.NVarChar(1000), body.reason); req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      const result = await req.query<{ changed: number }>(`
        UPDATE AssessmentPeriods SET status='reopened',input_revision=input_revision+1,final_total=NULL,finalized_by=NULL,finalized_at=NULL,notes=@reason WHERE id=@id AND status='finalized';
        DECLARE @changed INT=@@ROWCOUNT;
        IF @changed=1 INSERT ComplianceAssessmentAudit(entity_type,entity_id,action,actor,note) VALUES('period',@id,'reopened',@actor,@reason);
        SELECT @changed changed;
      `);
      if (!result.recordset[0]?.changed) return { status: 409, jsonBody: { error: "Only finalized periods can be reopened" } };
      return { status: 200, jsonBody: { id: request.params.id, status: "reopened" } };
    } catch (error) { context.error("POST assessment reopen failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
