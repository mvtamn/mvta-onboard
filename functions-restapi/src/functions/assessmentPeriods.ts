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
      const contractor = await req.query<{ id: string; agreement_id: string }>(`SELECT c.id,a.id agreement_id FROM Contractors c JOIN PerformanceAgreements a ON a.contractor_id=c.id AND a.is_active=1 WHERE c.id=@contractor AND c.is_active=1 AND CONCAT(@month,'01') BETWEEN CONVERT(char(8),a.starts_on,112) AND CONVERT(char(8),a.ends_on,112)`);
      if (!contractor.recordset[0]) return { status: 404, jsonBody: { error: "Current Agreement not found for this Assessment Period" } };
      const write = pool.request(); write.input("contractor", sql.UniqueIdentifier, body.contractor_id); write.input("month", sql.Char(6), body.service_month);
      write.input("agreement", sql.UniqueIdentifier, contractor.recordset[0].agreement_id);
      const result = await write.query<{ id: string }>(`
        IF NOT EXISTS(SELECT 1 FROM AssessmentPeriods WHERE contractor_id=@contractor AND service_month=@month)
          INSERT AssessmentPeriods(contractor_id,agreement_id,service_month) VALUES(@contractor,@agreement,@month);
        DECLARE @period UNIQUEIDENTIFIER=(SELECT TOP 1 id FROM AssessmentPeriods WHERE contractor_id=@contractor AND service_month=@month ORDER BY assessment_revision DESC);
        IF NOT EXISTS(SELECT 1 FROM AssessmentPeriodStandards WHERE period_id=@period)
        BEGIN
          INSERT AssessmentPeriodStandards(period_id,standard_id,code,name,standard_type,priority,direction,is_safety_critical,measurement_source,sort_order) SELECT @period,id,code,name,standard_type,priority,direction,is_safety_critical,measurement_source,sort_order FROM ContractorPerformanceStandards WHERE is_scored=1;
          INSERT AssessmentPeriodTiers SELECT @period,t.standard_id,t.tier_order,t.tier_label,t.bound_low,t.bound_high,t.qualifier_code,t.penalty_basis,t.penalty_amount,t.triggers_cap FROM ContractorStandardTiers t JOIN AssessmentPeriodStandards s ON s.period_id=@period AND s.standard_id=t.standard_id WHERE t.effective_start_date<=CONCAT(@month,'01') AND (t.effective_end_date IS NULL OR t.effective_end_date>=CONCAT(@month,'01'));
          DECLARE @rules NVARCHAR(MAX)=(SELECT s.*,JSON_QUERY((SELECT t.* FROM AssessmentPeriodTiers t WHERE t.period_id=s.period_id AND t.standard_id=s.standard_id ORDER BY t.tier_order FOR JSON PATH)) tiers FROM AssessmentPeriodStandards s WHERE s.period_id=@period ORDER BY s.sort_order FOR JSON PATH);
          UPDATE AssessmentPeriods SET rule_set_json=@rules,rule_set_sha256=CONVERT(char(64),HASHBYTES('SHA2_256',@rules),2) WHERE id=@period;
        END;
        SELECT @period id;
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
        UPDATE AssessmentPeriods SET status='finalized',final_total=(SELECT SUM(recommended_amount) FROM PeriodKpiAssessments WHERE period_id=@id),finalized_by=@actor,finalized_at=SYSUTCDATETIME()
        WHERE id=@id AND status='in_validation' AND validation_ends_on<=CONVERT(date,SYSUTCDATETIME()) AND computed_revision=input_revision
          AND EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id)
          AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id AND (recommended_action IS NULL OR reviewed_input_sha256<>input_sha256 OR (ISNULL(data_completeness_pct,0)<=0 AND assessment_outcome<>'not_assessable')))
          AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id AND reviewed_by=@actor)
          AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments a WHERE a.period_id=@id AND a.assessment_outcome='not_assessable' AND NOT EXISTS(SELECT 1 FROM AssessmentExceptions e WHERE e.assessment_id=a.id))
          AND NOT EXISTS(SELECT 1 FROM ComplianceOccurrences o JOIN AssessmentPeriods p ON p.contractor_id=o.contractor_id AND p.service_month=o.service_month WHERE p.id=@id AND o.review_status='candidate');
        DECLARE @changed INT=@@ROWCOUNT;
        IF @changed=1 UPDATE PeriodKpiAssessments SET manager_action=recommended_action,manager_reason=recommendation_reason,final_amount=recommended_amount,binding_decision_by=@actor WHERE period_id=@id;
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
      const result = await req.query<{ changed: number; id: string }>(`
        DECLARE @agreement UNIQUEIDENTIFIER,@month CHAR(6),@status NVARCHAR(20),@new_id UNIQUEIDENTIFIER=@id,@changed INT=0;
        SELECT @agreement=agreement_id,@month=service_month,@status=status FROM AssessmentPeriods WHERE id=@id;
        IF @status='finalized' BEGIN UPDATE AssessmentPeriods SET status='reopened',input_revision=input_revision+1,final_total=NULL,finalized_by=NULL,finalized_at=NULL,notes=@reason WHERE id=@id;SET @changed=1;END
        ELSE IF @status='issued' BEGIN
          SET @new_id=NEWID();
          INSERT AssessmentPeriods(id,contractor_id,agreement_id,service_month,status,input_revision,notes,rule_set_sha256,rule_set_json,assessment_revision,supersedes_period_id)
          SELECT @new_id,contractor_id,agreement_id,service_month,'reopened',input_revision+1,@reason,rule_set_sha256,rule_set_json,assessment_revision+1,id FROM AssessmentPeriods WHERE id=@id;
          INSERT AssessmentPeriodStandards(period_id,standard_id,code,name,standard_type,priority,direction,is_safety_critical,measurement_source,sort_order) SELECT @new_id,standard_id,code,name,standard_type,priority,direction,is_safety_critical,measurement_source,sort_order FROM AssessmentPeriodStandards WHERE period_id=@id;
          INSERT AssessmentPeriodTiers(period_id,standard_id,tier_order,tier_label,bound_low,bound_high,qualifier_code,penalty_basis,penalty_amount,triggers_cap) SELECT @new_id,standard_id,tier_order,tier_label,bound_low,bound_high,qualifier_code,penalty_basis,penalty_amount,triggers_cap FROM AssessmentPeriodTiers WHERE period_id=@id;
          SET @changed=1;
        END
        IF @changed=1 BEGIN
          INSERT ComplianceAssessmentAudit(entity_type,entity_id,action,actor,note) VALUES('period',@new_id,CASE WHEN @new_id=@id THEN 'reopened' ELSE 'correction_started' END,@actor,@reason);
          DECLARE @staled TABLE(id UNIQUEIDENTIFIER);
          UPDATE AssessmentPeriods SET status='stale',input_revision=input_revision+1
          OUTPUT inserted.id INTO @staled(id)
          WHERE agreement_id=@agreement AND service_month>@month AND status IN('open','in_review','in_validation','finalized');
          INSERT ComplianceAssessmentAudit(entity_type,entity_id,action,actor,note)
          SELECT 'period',id,'stale_due_to_prior_period_reopen',@actor,CONCAT('Earlier period ',@month,' was reopened')
          FROM @staled;
          INSERT AssessmentCorrectionImpacts(source_period_id,affected_period_id)
          SELECT @new_id,id FROM AssessmentPeriods WHERE agreement_id=@agreement AND service_month>@month AND status='issued'
          AND NOT EXISTS(SELECT 1 FROM AssessmentCorrectionImpacts i WHERE i.source_period_id=@new_id AND i.affected_period_id=AssessmentPeriods.id);
        END
        SELECT @changed changed,@new_id id;
      `);
      if (!result.recordset[0]?.changed) return { status: 409, jsonBody: { error: "Only finalized or issued periods can be reopened" } };
      return { status: 200, jsonBody: { id: result.recordset[0].id, status: "reopened" } };
    } catch (error) { context.error("POST assessment reopen failed", error); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
