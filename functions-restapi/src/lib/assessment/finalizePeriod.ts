import { auditSql } from "./audit";
import { voidLiveIssuanceProofSql } from "./issuanceProof";
import { reviewedItemsSha256Sql } from "./reviewedItems";
import { agreementScope } from "./schemaScope";
import { sql } from "../db";

// Finalization: the Issuing Authority binds the reviewed recommendations
// (ADR 0008). Every gate is in the WHERE: the Validation Window has ended,
// the share still matches the reviewed items (ADR 0009), one item per
// standard in the frozen Rule Set, nothing pending, no candidate
// occurrences, and a finalizer who reviewed nothing (separation of duties).
// Shared by the handler and the lifecycle contract test. The OTP trust gate
// stays in the handler: it is about the feed, not the period.
export async function finalizePeriod(pool: sql.ConnectionPool, input: { periodId: string; actor: string }): Promise<{ changed: boolean }> {
  const req = pool.request(); req.input("id", sql.UniqueIdentifier, input.periodId); req.input("actor", sql.NVarChar(200), input.actor);
  // Finalising is the moment the figure is agreed, so it is the moment the
  // rule set stops being a draft. Composed in only where migration 112a has
  // run, like every other guarded column.
  const scope = await agreementScope(pool);
  const lockOnFinalize = scope.rulesLock ? ",rules_locked_at=SYSUTCDATETIME()" : "";
  const result = await req.query<{ changed: number }>(`
        UPDATE AssessmentPeriods SET status='finalized',final_total=(SELECT SUM(CASE WHEN recommended_amount<0 THEN 0 ELSE recommended_amount END) FROM PeriodKpiAssessments WHERE period_id=@id),finalized_by=@actor,finalized_at=SYSUTCDATETIME()${lockOnFinalize}
        WHERE id=@id AND status='in_validation' AND validation_ends_on<=CONVERT(date,SYSUTCDATETIME()) AND computed_revision=input_revision
          AND EXISTS(SELECT 1 FROM ValidationDraftShares v WHERE v.period_id=@id AND v.superseded_at IS NULL AND v.computed_revision=AssessmentPeriods.computed_revision AND v.items_sha256=${reviewedItemsSha256Sql("id")})
          AND (SELECT COUNT(*) FROM PeriodKpiAssessments WHERE period_id=@id)=(SELECT COUNT(*) FROM AssessmentPeriodStandards WHERE period_id=@id)
          AND EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id)
          AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id AND (recommended_action IS NULL OR reviewed_input_sha256<>input_sha256 OR (ISNULL(data_completeness_pct,0)<=0 AND assessment_outcome<>'not_assessable')))
          AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id AND reviewed_by=@actor)
          AND NOT EXISTS(SELECT 1 FROM PeriodKpiAssessments a WHERE a.period_id=@id AND a.assessment_outcome='not_assessable' AND NOT EXISTS(SELECT 1 FROM AssessmentExceptions e WHERE e.assessment_id=a.id))
          AND NOT EXISTS(SELECT 1 FROM ComplianceOccurrences o JOIN AssessmentPeriods p ON p.contractor_id=o.contractor_id AND p.service_month=o.service_month WHERE p.id=@id AND o.review_status='candidate');
        DECLARE @changed INT=@@ROWCOUNT;
        IF @changed=1 BEGIN
          UPDATE PeriodKpiAssessments SET manager_action=recommended_action,manager_reason=recommendation_reason,final_amount=CASE WHEN recommended_amount<0 THEN 0 ELSE recommended_amount END,binding_amount=CASE WHEN recommended_amount<0 THEN 0 ELSE recommended_amount END,binding_reason=recommendation_reason,binding_decision_by=@actor,binding_decision_at=SYSUTCDATETIME() WHERE period_id=@id;
          -- A proof can only be prepared after finalization, so one that exists
          -- now was rendered from an earlier finalized state that went stale
          -- (evidence landed while it was being rendered). It is not the one
          -- to check for this finalization.
          ${voidLiveIssuanceProofSql("id","actor")}
          ${auditSql("period","@id","finalized","actor",{after:"(SELECT final_total,computed_revision FROM AssessmentPeriods WHERE id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)"})}
        END
        SELECT @changed changed;
      `);
  return { changed: Boolean(result.recordset[0]?.changed) };
}
