import type { Transaction } from "mssql";
import { sql } from "../db";
import {
  type AgreementScope,
  periodStandardSnapshotColumns,
  periodStandardSourceSql,
  periodTierScopeSql,
  periodTierSnapshotColumns,
} from "./schemaScope";

// Refreshing a draft period's rule set from the catalog.
//
// A period snapshots the standards and bands it is scored against when it
// opens, so that a finalised month recomputes to the same number months later.
// That promise only exists once a month has been finalised or issued. Before
// then the snapshot was silently permanent anyway: assigning a standard to an
// Agreement mid-month could never reach the open month, because recompute reads
// the snapshot and reopen copies the old snapshot forward. The only remedy was
// deleting the period row by hand.
//
// So a period whose rules are not yet locked has its snapshot rebuilt on every
// recompute, and one that is locked keeps the snapshot it was finalised with.
// The lock is a column rather than an inference from status: 'reopened' looks
// like a draft and is not one.
/**
 * The statement, composed against what this database has. Separated from the
 * execution so it can be read and asserted on without a server: the column
 * lists differ by migration, and a wrong one fails at parse time.
 */
export function periodRulesRefreshSql(scope: AgreementScope): string {
  const standardColumns = periodStandardSnapshotColumns(scope);
  const tierColumns = periodTierSnapshotColumns(scope);
  return `
    DELETE FROM AssessmentPeriodTiers WHERE period_id=@period;
    DELETE FROM AssessmentPeriodStandards WHERE period_id=@period;

    INSERT AssessmentPeriodStandards(period_id,standard_id,${standardColumns})
      SELECT @period,s.id,${standardColumns.split(",").map((column) => `s.${column}`).join(",")}
      ${periodStandardSourceSql(scope)};

    INSERT AssessmentPeriodTiers(${tierColumns.columns})
      SELECT ${tierColumns.select}
      FROM ContractorStandardTiers t
      JOIN AssessmentPeriodStandards s ON s.period_id=@period AND s.standard_id=t.standard_id
      WHERE t.effective_start_date<=CONCAT(@month,'01') AND (t.effective_end_date IS NULL OR t.effective_end_date>=CONCAT(@month,'01'))
        ${periodTierScopeSql(scope)};

    -- A queue row for a standard the rules no longer hold this contractor to
    -- would sit there scoring nothing and inviting a reviewer to act on it.
    DELETE k FROM PeriodKpiAssessments k
     WHERE k.period_id=@period
       AND NOT EXISTS(SELECT 1 FROM AssessmentPeriodStandards s
                       WHERE s.period_id=@period AND s.standard_id=k.standard_id);

    -- The rule-set hash is what an issued report cites, so it is rewritten
    -- from the rules that will actually be applied.
    DECLARE @rules NVARCHAR(MAX)=(SELECT s.*,JSON_QUERY((SELECT t.* FROM AssessmentPeriodTiers t WHERE t.period_id=s.period_id AND t.standard_id=s.standard_id ORDER BY t.tier_order FOR JSON PATH)) tiers FROM AssessmentPeriodStandards s WHERE s.period_id=@period ORDER BY s.sort_order FOR JSON PATH);
    UPDATE AssessmentPeriods SET rule_set_json=@rules,rule_set_sha256=CONVERT(char(64),HASHBYTES('SHA2_256',@rules),2) WHERE id=@period;
  `;
}

export async function refreshPeriodRules(
  tx: Transaction,
  scope: AgreementScope,
  period: { id: string; service_month: string },
): Promise<void> {
  const request = new sql.Request(tx);
  request.input("period", sql.UniqueIdentifier, period.id);
  request.input("month", sql.Char(6), period.service_month);
  await request.query(periodRulesRefreshSql(scope));
}
