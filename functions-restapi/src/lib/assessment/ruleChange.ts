import type { ConnectionPool, Transaction } from "mssql";
import { sql } from "../db";

// Telling a drafting period that its rules moved underneath it.
//
// Everything that changes a period's MEASUREMENTS already marks it stale: a
// logged occurrence, a reviewed occurrence, a manual metric, added evidence.
// Nothing that changes its RULES did. Assign a standard to an Agreement, edit a
// penalty band, retire a standard mid-month, and the period went on reading as
// current and correct - "computed 7 September, nothing has changed since" -
// when what it would score had changed materially.
//
// Marking it stale is what puts Recompute in front of the reviewer. It is only
// honest alongside ruleRefresh: before that, a recompute read a frozen snapshot
// and the button could not have delivered what the flag promised.
//
// Only periods that are still drafting are touched. A finalised or issued month
// is not made stale by a rule written afterwards - its figure was agreed under
// the rules of its own time, and correcting it is a reopen, deliberately.
const STALE_STATUSES = "('open','in_review','in_validation','stale','reopened')";

const AUDIT_NOTE = "Rules changed after this period opened";

export interface RuleChangeScope {
  /** Limit to one contractor's periods. Omit for a catalog-wide change. */
  contractorId?: string | null;
  /** Limit to periods of one agreement. */
  agreementId?: string | null;
}

function whereClause(scope: RuleChangeScope): string {
  const clauses = ["p.status IN " + STALE_STATUSES, "p.rules_locked_at IS NULL"];
  if (scope.contractorId) clauses.push("p.contractor_id=@contractor");
  if (scope.agreementId) clauses.push("p.agreement_id=@agreement");
  return clauses.join(" AND ");
}

/**
 * Marks every still-drafting period the change can reach as stale, and records
 * why. Returns the number of periods affected.
 *
 * A no-op where migration 112 has not run: without the lock column there is no
 * way to tell a draft period from a finalised one, and marking a finalised
 * month stale would invite a recompute of a figure already issued.
 */
export async function markRulesChanged(
  executor: ConnectionPool | Transaction,
  scope: RuleChangeScope,
  actor: string,
  hasRulesLock: boolean,
): Promise<number> {
  if (!hasRulesLock) return 0;
  const request = executor instanceof sql.Transaction
    ? new sql.Request(executor)
    : executor.request();
  request.input("actor", sql.NVarChar(200), actor);
  request.input("note", sql.NVarChar(1000), AUDIT_NOTE);
  if (scope.contractorId) request.input("contractor", sql.UniqueIdentifier, scope.contractorId);
  if (scope.agreementId) request.input("agreement", sql.UniqueIdentifier, scope.agreementId);
  const result = await request.query<{ staled: number }>(`
    DECLARE @staled TABLE(id UNIQUEIDENTIFIER);
    UPDATE p SET status='stale',input_revision=input_revision+1
    OUTPUT inserted.id INTO @staled(id)
    FROM AssessmentPeriods p
    WHERE ${whereClause(scope)};
    INSERT ComplianceAssessmentAudit(entity_type,entity_id,action,actor,note)
      SELECT 'period',id,'stale_due_to_rule_change',@actor,@note FROM @staled;
    SELECT COUNT(*) staled FROM @staled;
  `);
  return result.recordset[0]?.staled ?? 0;
}
