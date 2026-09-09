import type { AssessmentPeriodStatus, PeriodKpiAssessment } from "@mvta/shared";

// Review writes recommended_action; finalization copies it into
// manager_action as the binding decision. Reading manager_action before
// that makes every reviewed item look pending until the month is finalized.
export function reviewDisplay(status: AssessmentPeriodStatus, row: Pick<PeriodKpiAssessment, "recommended_action" | "manager_action">): { heading: "Recommendation" | "Binding decision"; value: string } {
  if (status === "finalized" || status === "issued") return { heading: "Binding decision", value: row.manager_action };
  if (status === "open") return { heading: "Recommendation", value: "—" };
  return { heading: "Recommendation", value: row.recommended_action ?? "awaiting review" };
}
