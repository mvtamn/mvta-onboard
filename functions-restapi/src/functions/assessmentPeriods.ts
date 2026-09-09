import { auditSql } from "../lib/assessment/audit";
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { assessPeriod } from "../lib/assessment/assess";
import { finalizePeriod } from "../lib/assessment/finalizePeriod";
import { openPeriodSql } from "../lib/assessment/openPeriod";
import { agreementScope, assignedStandardCountSql, periodStandardSnapshotColumns, periodTierCopyColumns } from "../lib/assessment/schemaScope";
import { COMPLIANCE_MANAGER_ROLES, COMPLIANCE_READ_ROLES, COMPLIANCE_WRITE_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { loadKpiTrust } from "../lib/kpiTrustStore";
import { isGuid, isServiceMonth } from "../lib/validation";
import { voidLiveIssuanceProofSql } from "../lib/assessment/issuanceProof";
import { reviewedItemsSha256Sql } from "../lib/assessment/reviewedItems";

app.http("assessmentPeriodsList", {
  route: "assessment-periods", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      const check = await pool.request().query<{ ready: number }>(`SELECT CASE WHEN OBJECT_ID('dbo.AssessmentPeriods','U') IS NULL THEN 0 ELSE 1 END ready`);
      if (!check.recordset[0]?.ready) return { status: 200, jsonBody: { periods: [], diagnostics: { table_ready: false } } };
      const q = pool.request(); const contractor = request.query.get("contractor_id");
      const limit = Math.min(500, Math.max(1, Number(request.query.get("limit") ?? 120) || 120));
      q.input("contractor", sql.UniqueIdentifier, isGuid(contractor) ? contractor : null); q.input("limit", sql.Int, limit);
      const result = await q.query(`SELECT TOP (@limit) p.*,c.name contractor_name FROM AssessmentPeriods p JOIN Contractors c ON c.id=p.contractor_id WHERE (@contractor IS NULL OR p.contractor_id=@contractor) ORDER BY service_month DESC,c.name`);
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
      // Composed against what this database actually has: before migration 102
      // there is no per-agreement assignment, and the period snapshots the
      // agency catalog exactly as it did before this feature existed.
      const scope = await agreementScope(pool);
      const req = pool.request(); req.input("contractor", sql.UniqueIdentifier, body.contractor_id); req.input("month", sql.Char(6), body.service_month);
      // The agreement, plus how many standards it actually assigns for this
      // month. A period whose agreement assigns nothing would open, snapshot an
      // empty rule set, and compute a $0 assessment that looks like a clean
      // month - so it is refused here rather than produced.
      const contractor = await req.query<{ id: string; agreement_id: string; assigned: number }>(`
        SELECT c.id,a.id agreement_id,
          ${assignedStandardCountSql(scope)} assigned
        FROM Contractors c JOIN PerformanceAgreements a ON a.contractor_id=c.id AND a.is_active=1
        WHERE c.id=@contractor AND c.is_active=1
          AND CONCAT(@month,'01') BETWEEN CONVERT(char(8),a.starts_on,112) AND CONVERT(char(8),a.ends_on,112)`);
      if (!contractor.recordset[0]) return { status: 404, jsonBody: { error: "Current Agreement not found for this Assessment Period" } };
      if (!contractor.recordset[0].assigned) {
        return { status: 400, jsonBody: { error: scope.scoped
          ? "No performance standards are assigned to this Agreement for this month. Assign them under Administration > Performance Standards."
          : "No performance standards are marked as scored in the catalog for this month." } };
      }
      const write = pool.request(); write.input("contractor", sql.UniqueIdentifier, body.contractor_id); write.input("month", sql.Char(6), body.service_month);
      write.input("agreement", sql.UniqueIdentifier, contractor.recordset[0].agreement_id);
      const result = await write.query<{ id: string }>(openPeriodSql(scope));
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
      const pool = await getPool();
      const otpTrust = (await loadKpiTrust(pool)).otp;
      if (otpTrust.state !== "current" && otpTrust.state !== "current_but_empty") {
        return { status: 409, jsonBody: { error: "Assessment finalization is unavailable while OTP KPI trust is stale or unavailable." } };
      }
      const result = await finalizePeriod(pool, { periodId: request.params.id, actor: auth.principal.userDetails ?? "onboard-console" });
      if (!result.changed) return { status: 409, jsonBody: { error: "Period is stale, incomplete, has pending KPI review, or its Shared Validation Draft no longer matches the reviewed items" } };
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
      const pool = await getPool();
      const reopenScope = await agreementScope(pool);
      const req = pool.request(); req.input("id", sql.UniqueIdentifier, request.params.id); req.input("reason", sql.NVarChar(1000), body.reason); req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      const result = await req.query<{ changed: number; id: string }>(`
        DECLARE @agreement UNIQUEIDENTIFIER,@month CHAR(6),@status NVARCHAR(20),@new_id UNIQUEIDENTIFIER=@id,@changed INT=0;
        SELECT @agreement=agreement_id,@month=service_month,@status=status FROM AssessmentPeriods WHERE id=@id;
        IF @status='finalized' BEGIN UPDATE AssessmentPeriods SET status='reopened',input_revision=input_revision+1,final_total=NULL,finalized_by=NULL,finalized_at=NULL,notes=@reason WHERE id=@id;SET @changed=1;
          ${voidLiveIssuanceProofSql("id","actor")}
        END
        ELSE IF @status='issued' BEGIN
          SET @new_id=NEWID();
          INSERT AssessmentPeriods(id,contractor_id,agreement_id,service_month,status,input_revision,notes,rule_set_sha256,rule_set_json,assessment_revision,supersedes_period_id)
          SELECT @new_id,contractor_id,agreement_id,service_month,'reopened',input_revision+1,@reason,rule_set_sha256,rule_set_json,assessment_revision+1,id FROM AssessmentPeriods WHERE id=@id;
          INSERT AssessmentPeriodStandards(period_id,standard_id,${periodStandardSnapshotColumns(reopenScope)}) SELECT @new_id,standard_id,${periodStandardSnapshotColumns(reopenScope)} FROM AssessmentPeriodStandards WHERE period_id=@id;
          INSERT AssessmentPeriodTiers(period_id,${periodTierCopyColumns(reopenScope)}) SELECT @new_id,${periodTierCopyColumns(reopenScope)} FROM AssessmentPeriodTiers WHERE period_id=@id;
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
