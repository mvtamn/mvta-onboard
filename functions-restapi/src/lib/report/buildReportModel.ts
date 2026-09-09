import type { AssessmentReportModel, ReportAssessment } from "./renderAssessmentReport";

// The SQL rows behind an artifact, as the handler selects them. Kept as the
// raw column names so the mapping below is the only place they are read.
export interface ReportPeriodRow { contractor_name: string; service_month: string; is_partial: boolean | null; proposed_total: number | null; final_total: number | null }
export interface ReportItemRow {
  name: string; standard_type: string; metric_display: string | null; target_display: string | null; tier_label: string; assessment_outcome: string | null;
  occurrence_count: number; base_amount: number; escalation_multiplier: number; proposed_amount: number;
  recommended_action: string | null; recommended_amount: number | null; recommendation_reason: string | null;
  manager_action: string | null; manager_reason: string | null; final_amount: number | null; binding_amount: number | null; binding_reason: string | null;
  excluded_occurrence_count: number | null; excluded_unit_quantity: number | null; data_completeness_pct: number | null;
}
export interface ReportEvidenceRow { assessment_name: string; caption: string | null; content_sha256: string }

// Pure: rows in, model out. A Validation Draft shows what review recommends,
// because that is what finalization will bind - a draft that showed the raw
// proposal could differ from the Final without a new Validation Window
// (ADR 0009). A Final shows the binding decision. The computed amount is the
// same on both: base × escalation, with relief already removed from the
// inputs before tiering (ADR 0012), never subtracted from a dollar figure.
export function buildReportModel(input: { reportId: string; type: "preliminary" | "final"; version: number; period: ReportPeriodRow; rows: ReportItemRow[]; evidence: ReportEvidenceRow[]; issuedAt: Date | null; deadline: Date | null }): AssessmentReportModel {
  const final = input.type === "final";
  const assessments: ReportAssessment[] = input.rows.map(a => {
    const notAssessable = a.assessment_outcome === "not_assessable";
    const computedAmount = Number(a.base_amount) * Number(a.escalation_multiplier);
    const reviewAction = final ? (a.manager_action ?? "pending") : (a.recommended_action ?? "pending");
    const reviewReason = final ? (a.binding_reason ?? a.manager_reason) : a.recommendation_reason;
    // Never negative (ADR 0012): the same clamp finalization applies.
    const assessedAmount = Math.max(0, final
      ? Number(a.binding_amount ?? a.final_amount ?? 0)
      : Number(a.recommended_action ? a.recommended_amount ?? 0 : a.proposed_amount));
    return {
      name: a.name, standardType: a.standard_type,
      metricDisplay: notAssessable ? "Not Assessable" : a.metric_display ?? "",
      targetDisplay: a.target_display ?? "",
      tierLabel: notAssessable ? "Not Assessable" : a.tier_label,
      occurrenceCount: a.occurrence_count,
      baseAmount: Number(a.base_amount), escalationMultiplier: Number(a.escalation_multiplier), computedAmount,
      excludedOccurrenceCount: Number(a.excluded_occurrence_count ?? 0), excludedUnitQuantity: Number(a.excluded_unit_quantity ?? 0),
      reviewAction, reviewReason: reviewReason ?? null, assessedAmount,
      dataCompletenessPct: a.data_completeness_pct,
    };
  });
  const assessedTotal = final ? Number(input.period.final_total ?? 0) : assessments.reduce((sum, a) => sum + a.assessedAmount, 0);
  return {
    reportId: input.reportId, issuanceType: input.type, version: input.version,
    contractorName: input.period.contractor_name, serviceMonth: input.period.service_month,
    issuedAt: input.issuedAt?.toISOString() ?? null, issuedBy: null,
    disputeDeadline: input.deadline?.toISOString().slice(0, 10) ?? null,
    isPartial: Boolean(input.period.is_partial), assessedTotal, assessments,
    evidence: input.evidence.map(e => ({ assessmentName: e.assessment_name, caption: e.caption ?? "Evidence", contentSha256: e.content_sha256 })),
  };
}
