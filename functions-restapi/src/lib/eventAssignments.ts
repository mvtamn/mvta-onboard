export type AssignmentPlanStatus = "draft" | "review" | "approved" | "active" | "suspended" | "completed";

export type AssignmentTarget = "plan" | "revision" | "invalid";

export function assignmentTarget(status: AssignmentPlanStatus): AssignmentTarget {
  if (status === "draft" || status === "review") return "plan";
  if (status === "active") return "revision";
  return "invalid";
}
