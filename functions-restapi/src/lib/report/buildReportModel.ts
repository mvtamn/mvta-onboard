import type { AssessmentReportModel, ReportAssessment, ReportCap, ReportDataSource, ReportException, ReportOccurrence, ReportOtpExclusion } from "./renderAssessmentReport";
import { isHandEntered, MEASUREMENT_SOURCE_LABELS, normalizeMeasurementSource } from "../assessment/measurementSource";

// The SQL rows behind an artifact, as the handler selects them. Kept as the
// raw column names so the mapping below is the only place they are read.
export interface ReportPeriodRow { contractor_name: string; service_month: string; is_partial: boolean | null; proposed_total: number | null; final_total: number | null }
export interface ReportItemRow {
  name: string; standard_type: string; metric_display: string | null; target_display: string | null; tier_label: string; assessment_outcome: string | null;
  /** How a figure made from parts was made, from migration 115 on; absent or null before it and for a figure typed whole. */
  metric_working?: string | null;
  occurrence_count: number; base_amount: number; escalation_multiplier: number; proposed_amount: number;
  recommended_action: string | null; recommended_amount: number | null; recommendation_reason: string | null;
  manager_action: string | null; manager_reason: string | null; final_amount: number | null; binding_amount: number | null; binding_reason: string | null;
  excluded_occurrence_count: number | null; excluded_unit_quantity: number | null; data_completeness_pct: number | null;
}
export interface ReportEvidenceRow { assessment_name: string; caption: string | null; content_sha256: string }
export interface ReportOccurrenceRow { standard_name: string; service_date: string; description: string; quantity: number; qualifier_code: string | null; attribution: string; source_ref: string | null; claim_status: string | null; claim_description: string | null; evidence_hashes: string | null; outage_system?: string | null }
export interface ReportExceptionRow { standard_name: string; reason: string; missing_data_owner: string; remediation_action: string; expected_correction_date: Date | string }
// A CAP Determination is made by the compute (cap_required) and the row in
// CorrectiveActionPlans only exists once the month is issued, so a proof or a
// Final rendered at issue reads the determination from the item and the due
// date from the plan row when there is one, else from the issuance clock.
export interface ReportCapRow { standard_name: string; trigger_reason: string | null; due_at: Date | string | null; status: string | null; cap_reason: string | null }
export interface ReportStandardRow { name: string; standard_type: string; measurement_source: string | null; data_completeness_pct: number | null; assessment_outcome: string | null }
export interface ReportOtpExclusionRow { reason_code: string; stop_count: number }
export interface ReportSchedules { occurrences?: ReportOccurrenceRow[]; exceptions?: ReportExceptionRow[]; caps?: ReportCapRow[]; standards?: ReportStandardRow[]; otpExclusions?: ReportOtpExclusionRow[]; capDeadline?: Date | null }
// ISO strings, Date objects, and the schema's CHAR(8) days all print the same.
export const isoDate = (value: Date | string) => { const v = value instanceof Date ? value.toISOString() : String(value); return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v.slice(0, 10); };

// Why an occurrence was left out, in the words the contractor should read.
// Relief is removed from the inputs before tiering (ADR 0012); this is where
// the report says so.
function exclusionReason(o: ReportOccurrenceRow): string | null {
  if (o.outage_system) return `System outage: ${o.outage_system.replace(/_/g, " ")}`;
  if (o.claim_status === "approved") return `Approved excusable-delay claim: ${o.claim_description ?? "documented"}`;
  if (o.attribution === "excusable") return "Attributed as excusable";
  if (o.attribution === "mvta_directed") return "Attributed to MVTA direction";
  if (o.attribution !== "contractor_error") return "Attribution undetermined";
  return null;
}

// Pure: rows in, model out. A Validation Draft shows what review recommends,
// because that is what finalization will bind - a draft that showed the raw
// proposal could differ from the Final without a new Validation Window
// (ADR 0009). A Final shows the binding decision. The computed amount is the
// same on both: base × escalation, with relief already removed from the
// inputs before tiering (ADR 0012), never subtracted from a dollar figure.
export function buildReportModel(input: { reportId: string; type: "preliminary" | "final"; version: number; period: ReportPeriodRow; rows: ReportItemRow[]; evidence: ReportEvidenceRow[]; issuedAt: Date | null; deadline: Date | null; schedules?: ReportSchedules }): AssessmentReportModel & { occurrences: ReportOccurrence[]; exceptions: ReportException[]; caps: ReportCap[]; dataSources: ReportDataSource[]; otpExclusions: ReportOtpExclusion[] } {
  const sched = input.schedules ?? {};
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
      metricWorking: notAssessable ? null : a.metric_working ?? null,
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
    disputeDeadline: input.deadline ? isoDate(input.deadline) : null,
    isPartial: Boolean(input.period.is_partial), assessedTotal, assessments,
    evidence: input.evidence.map(e => ({ assessmentName: e.assessment_name, caption: e.caption ?? "Evidence", contentSha256: e.content_sha256 })),
    occurrences: (sched.occurrences ?? []).map((o): ReportOccurrence => { const why = exclusionReason(o); return { standardName: o.standard_name, serviceDate: o.service_date, description: o.description, quantity: o.quantity, qualifierCode: o.qualifier_code, sourceRef: o.source_ref, evidenceHashes: (o.evidence_hashes ?? "").split("|").filter(Boolean), counted: why === null, exclusionReason: why }; }),
    exceptions: (sched.exceptions ?? []).map((e): ReportException => ({ standardName: e.standard_name, reason: e.reason, missingDataOwner: e.missing_data_owner, remediationAction: e.remediation_action, expectedCorrectionDate: isoDate(e.expected_correction_date) })),
    caps: (sched.caps ?? []).map((c): ReportCap => ({ standardName: c.standard_name, triggerReason: c.trigger_reason ?? c.cap_reason ?? "tier_rule", dueAt: c.due_at ? isoDate(c.due_at) : sched.capDeadline ? isoDate(sched.capDeadline) : null, status: c.status ?? "required" })),
    dataSources: (sched.standards ?? []).map((d): ReportDataSource => { const source = normalizeMeasurementSource(d.measurement_source, d.standard_type === "occurrence" ? "occurrence" : "threshold"); return { standardName: d.name, source: MEASUREMENT_SOURCE_LABELS[source], handEntered: isHandEntered(source), dataCompletenessPct: d.data_completeness_pct, notAssessable: d.assessment_outcome === "not_assessable" }; }),
    otpExclusions: (sched.otpExclusions ?? []).map((x): ReportOtpExclusion => ({ reasonCode: x.reason_code, stopCount: x.stop_count })),
  };
}
