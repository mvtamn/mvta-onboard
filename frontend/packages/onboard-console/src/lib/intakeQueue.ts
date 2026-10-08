// Which detour intakes are waiting on OCC.
//
// Submitting an intake notified nobody: no email, no Teams post, no queue
// entry, and the Dashboard never fetched intake at all. The only way OCC
// learned that somebody had asked for a detour was by opening the Intake page
// and noticing. This is what puts it in front of them instead.
//
// Only `pending_review` counts. `needs_information` was returned to whoever
// raised it and is waiting on THEM - putting it in OCC's queue would be asking
// them to act on something that is not their move, which is how a queue stops
// meaning anything.
import type { DetourIntake } from "@mvta/shared";

export function isWaitingOnOcc(intake: Pick<DetourIntake, "status">): boolean {
  return intake.status === "pending_review";
}

export function pendingIntakes(intake: readonly DetourIntake[] | null): DetourIntake[] {
  return (intake ?? []).filter(isWaitingOnOcc);
}

/** How long it has been waiting, in whole hours, for the queue's ordering. */
export function waitingHours(intake: Pick<DetourIntake, "created_at">, now = Date.now()): number {
  const created = new Date(intake.created_at).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((now - created) / (60 * 60 * 1000)));
}

/**
 * How the wait reads on a row. Hours until a day has passed, then days: an
 * intake sitting for three days is a different problem from one that arrived
 * over lunch, and "72h" makes the reader do the division.
 */
export function waitingLabel(hours: number): string {
  if (hours < 1) return "Just arrived";
  if (hours < 24) return `Waiting ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Waiting ${days} day${days === 1 ? "" : "s"}`;
}
