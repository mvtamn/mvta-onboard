// The intake rule in SQL: which Agreement, and so which Assessment Contractor,
// an occurrence belongs to, and whether it may be written.
//
// The contractor is the one of the single active Agreement whose term covers
// the service date (ADR 0005). Zero or several covering Agreements is an
// Unassigned Candidate - never a tie broken by which contractor was edited
// last. The Agreement must score the standard on that date, and that
// contractor's month must not be finalized or issued.
//
// `dateExpr` is a CHAR(8) YYYYMMDD expression and `standardExpr` a standard id
// expression, both over rows already in scope. `as` names the result, whose
// columns are agreement_id, contractor_id, period_status and intake.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function occurrenceAssignmentSql(dateExpr: string, standardExpr: string, as: string): string {
  if (!IDENTIFIER.test(as)) throw new TypeError("occurrenceAssignmentSql alias must be a plain identifier");
  return `
    CROSS APPLY (
      SELECT COUNT(*) agreements,
        CONVERT(UNIQUEIDENTIFIER, MAX(CONVERT(CHAR(36), a.id))) agreement_id,
        CONVERT(UNIQUEIDENTIFIER, MAX(CONVERT(CHAR(36), a.contractor_id))) contractor_id
      FROM PerformanceAgreements a
      WHERE a.is_active=1 AND CONVERT(date,${dateExpr},112) BETWEEN a.starts_on AND a.ends_on
    ) ${as}_cover
    CROSS APPLY (
      SELECT
        CASE WHEN ${as}_cover.agreements=1 THEN ${as}_cover.agreement_id END agreement_id,
        CASE WHEN ${as}_cover.agreements=1 THEN ${as}_cover.contractor_id END contractor_id,
        CASE WHEN ${as}_cover.agreements=1 AND EXISTS(
          SELECT 1 FROM AgreementStandards ags
          WHERE ags.agreement_id=${as}_cover.agreement_id AND ags.standard_id=${standardExpr} AND ags.is_scored=1
            AND ags.effective_start_date<=${dateExpr}
            AND (ags.effective_end_date IS NULL OR ags.effective_end_date>=${dateExpr})) THEN 1 ELSE 0 END scored,
        (SELECT p.status FROM AssessmentPeriods p
          WHERE ${as}_cover.agreements=1 AND p.contractor_id=${as}_cover.contractor_id AND p.service_month=LEFT(${dateExpr},6)) period_status
    ) ${as}_facts
    CROSS APPLY (
      SELECT ${as}_facts.agreement_id, ${as}_facts.contractor_id, ${as}_facts.period_status,
        CAST(CASE WHEN ${as}_facts.agreement_id IS NULL THEN 'unassigned'
          WHEN ${as}_facts.scored=0 THEN 'standard_not_scored'
          WHEN ${as}_facts.period_status IN ('finalized','issued') THEN 'period_closed'
          ELSE 'accepted' END AS NVARCHAR(30)) intake
    ) ${as}`;
}

// Everything the module writes to or reads for the rule. Environments missing
// any of it get schema_not_ready, never a guessed contractor.
export const INTAKE_READY_SQL = `
  SELECT CASE WHEN OBJECT_ID('dbo.ComplianceOccurrences','U') IS NULL
    OR OBJECT_ID('dbo.PerformanceAgreements','U') IS NULL
    OR OBJECT_ID('dbo.AgreementStandards','U') IS NULL
    OR OBJECT_ID('dbo.AssessmentPeriods','U') IS NULL THEN 0 ELSE 1 END ready`;
