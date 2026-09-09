import type { AssessmentPeriodStatus, PeriodKpiAssessment } from "@mvta/shared";

// Review writes recommended_action; finalization copies it into
// manager_action as the binding decision (a Binding Adjustment or Penalty
// Waiver in the glossary's terms). Reading manager_action before that makes
// every reviewed item look pending until the month is finalized.
export function reviewHeading(status: AssessmentPeriodStatus): "Recommendation" | "Binding decision" {
  return status === "finalized" || status === "issued" ? "Binding decision" : "Recommendation";
}

export function reviewDisplay(status: AssessmentPeriodStatus, row: Pick<PeriodKpiAssessment, "recommended_action" | "manager_action" | "final_amount">): { heading: "Recommendation" | "Binding decision"; value: string } {
  const heading = reviewHeading(status);
  if (heading === "Binding decision") return { heading, value: row.final_amount === null || row.final_amount === undefined ? row.manager_action : `${row.manager_action} · ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(row.final_amount)}` };
  if (status === "open") return { heading, value: "—" };
  return { heading, value: row.recommended_action ?? "awaiting review" };
}
