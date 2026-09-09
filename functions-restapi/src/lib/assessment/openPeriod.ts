import type { AgreementScope } from "./schemaScope";
import { periodStandardSnapshotColumns, periodStandardSourceSql, periodTierScopeSql, periodTierSnapshotColumns } from "./schemaScope";

// Opening an Assessment Period: the row, then the frozen Assessment Rule Set
// (ADR 0006) - the standards the Agreement assigns for the month and the
// tiers effective on its first day, snapshotted so a later catalog edit
// cannot change what the month was scored against - and its hash. Shared by
// the open handler and the lifecycle contract test, so the test opens a
// period exactly as the console does. Binds @contractor, @month, @agreement.
export function openPeriodSql(scope: AgreementScope): string {
  return `
        IF NOT EXISTS(SELECT 1 FROM AssessmentPeriods WHERE contractor_id=@contractor AND service_month=@month)
          INSERT AssessmentPeriods(contractor_id,agreement_id,service_month) VALUES(@contractor,@agreement,@month);
        DECLARE @period UNIQUEIDENTIFIER=(SELECT TOP 1 id FROM AssessmentPeriods WHERE contractor_id=@contractor AND service_month=@month ORDER BY assessment_revision DESC);
        IF NOT EXISTS(SELECT 1 FROM AssessmentPeriodStandards WHERE period_id=@period)
        BEGIN
          INSERT AssessmentPeriodStandards(period_id,standard_id,${periodStandardSnapshotColumns(scope)})
            SELECT @period,s.id,${periodStandardSnapshotColumns(scope).split(",").map((column) => `s.${column}`).join(",")}
            ${periodStandardSourceSql(scope)};
          -- Tier precedence (migration 102): an agreement's own tier rows
          -- govern the whole ladder for that standard, or none of it. Blending
          -- an override with catalog defaults would produce bands nobody wrote.
          -- Pre-102 every row is a catalog default and the clause is empty.
          INSERT AssessmentPeriodTiers(${periodTierSnapshotColumns(scope).columns})
            SELECT ${periodTierSnapshotColumns(scope).select}
            FROM ContractorStandardTiers t
            JOIN AssessmentPeriodStandards s ON s.period_id=@period AND s.standard_id=t.standard_id
            WHERE t.effective_start_date<=CONCAT(@month,'01') AND (t.effective_end_date IS NULL OR t.effective_end_date>=CONCAT(@month,'01'))
              ${periodTierScopeSql(scope)};
          DECLARE @rules NVARCHAR(MAX)=(SELECT s.*,JSON_QUERY((SELECT t.* FROM AssessmentPeriodTiers t WHERE t.period_id=s.period_id AND t.standard_id=s.standard_id ORDER BY t.tier_order FOR JSON PATH)) tiers FROM AssessmentPeriodStandards s WHERE s.period_id=@period ORDER BY s.sort_order FOR JSON PATH);
          UPDATE AssessmentPeriods SET rule_set_json=@rules,rule_set_sha256=CONVERT(char(64),HASHBYTES('SHA2_256',@rules),2) WHERE id=@period;
        END;
        SELECT @period id;`;
}
