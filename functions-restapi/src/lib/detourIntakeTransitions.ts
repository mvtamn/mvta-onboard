// Detour Intake status rules, kept pure so the handlers in
// functions/detourIntake.ts stay thin and the matrix is testable without a
// database.
//
// An intake returned for information is still open: the reporter updates
// the record and it goes back to the review queue, or a reviewer closes it
// out. Only acceptance (promotion), rejection, duplicate, and withdrawal
// are terminal.

export type DetourIntakeStatus = "pending_review" | "needs_information" | "accepted" | "rejected" | "duplicate" | "withdrawn";
export type DetourIntakeReviewOutcome = "needs_information" | "rejected" | "duplicate" | "withdrawn";

export const OPEN_INTAKE_STATUSES: readonly DetourIntakeStatus[] = ["pending_review", "needs_information"];

export function isOpenIntakeStatus(status: string): status is "pending_review" | "needs_information" {
  return (OPEN_INTAKE_STATUSES as readonly string[]).includes(status);
}

// Why a review outcome cannot be applied to an intake in `current`, or
// null when it can.
export function intakeReviewRefusal(current: DetourIntakeStatus, outcome: DetourIntakeReviewOutcome): string | null {
  if (!isOpenIntakeStatus(current)) return `Intake is already ${current.replace("_", " ")} and cannot be reviewed again`;
  if (current === "needs_information" && outcome === "needs_information") return "Intake is already returned for information";
  return null;
}

// Whether the record's content may still be edited, and what status an
// edit lands it in. Editing a returned intake is the resubmission: it goes
// straight back to the review queue rather than needing a separate step.
export function intakeStatusAfterUpdate(current: DetourIntakeStatus): "pending_review" | null {
  return isOpenIntakeStatus(current) ? "pending_review" : null;
}
