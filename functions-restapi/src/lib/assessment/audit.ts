// Every governance act on an Assessment Period writes one row to
// ComplianceAssessmentAudit, in one shape, so the trail a dispute is defended
// with reads the same whichever handler wrote it. Action names match the
// in-memory workflow seam's audit() so the two can be compared.
//
// `entityIdExpr` and `actorParam` are T-SQL expressions the caller has in
// scope (a bound parameter, a declared variable, or a column in an OUTPUT);
// `after` and `before` are optional T-SQL expressions producing JSON text.
export const AUDIT_ACTIONS = ["computed", "reviewed", "validation_shared", "finalized", "draft_generated", "issuance_proof_prepared", "issuance_proof_voided", "issued", "reopened", "correction_started", "stale_due_to_prior_period_reopen", "exception_authorized", "evidence_added", "dispute_filed", "dispute_decided", "cap_transitioned"] as const;
export type AuditAction = typeof AUDIT_ACTIONS[number];
export type AuditEntity = "period" | "assessment" | "report" | "dispute" | "cap";

export function auditSql(entity: AuditEntity, entityIdExpr: string, action: AuditAction, actorParam: string, opts: { before?: string; after?: string; note?: string } = {}): string {
  return `INSERT ComplianceAssessmentAudit(entity_type,entity_id,action,actor,before_json,after_json,note) VALUES('${entity}',${entityIdExpr},'${action}',@${actorParam},${opts.before ?? "NULL"},${opts.after ?? "NULL"},${opts.note ?? "NULL"});`;
}

// The period's whole trail: rows on the period itself, on its Assessment
// Items, on its reports, and on disputes against those reports. Newest first.
export function periodAuditSelectSql(periodParam: string): string {
  return `SELECT a.id,a.entity_type,a.entity_id,a.action,a.actor,a.before_json,a.after_json,a.note,a.created_at
    FROM ComplianceAssessmentAudit a
    WHERE (a.entity_type='period' AND a.entity_id=@${periodParam})
       OR (a.entity_type='assessment' AND a.entity_id IN (SELECT id FROM PeriodKpiAssessments WHERE period_id=@${periodParam}))
       OR (a.entity_type='report' AND a.entity_id IN (SELECT id FROM ComplianceReports WHERE period_id=@${periodParam}))
       OR (a.entity_type='dispute' AND a.entity_id IN (SELECT d.id FROM PenaltyDisputes d JOIN ComplianceReports r ON r.id=d.report_id WHERE r.period_id=@${periodParam}))
       OR (a.entity_type='cap' AND a.entity_id IN (SELECT id FROM CorrectiveActionPlans WHERE period_id=@${periodParam}))
    ORDER BY a.created_at DESC,a.id DESC`;
}
