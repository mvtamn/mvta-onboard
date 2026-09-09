// A CAP Determination is made when a month is issued (ADR 0013 anchors the
// deadline to issuance). From there the plan itself has a life: the
// contractor submits it, the Issuing Authority approves it, work proceeds,
// and it closes or fails. Each step is one transition, taken by the role
// Attachment G gives it, with the fields that step must record. Nothing
// skips a step, and a closed or failed plan is history.
export const CAP_SUBMISSION_FIELDS = ["root_cause", "corrective_actions", "responsible_parties", "timeline_note", "monitoring_plan", "closure_criteria"] as const;
export type CapSubmissionField = typeof CAP_SUBMISSION_FIELDS[number];
export type CapStatus = "required" | "submitted" | "approved" | "in_progress" | "closed" | "failed";
export type CapRole = "writer" | "manager";
export type CapFields = Partial<Record<CapSubmissionField | "closure_note", unknown>>;
export type CapTransition = { ok: true; sets: string[]; stamps: "submitted_at" | "closed_at" | null } | { ok: false; error: string };

const STEPS: Record<`${CapStatus}->${CapStatus}` & string, { role: CapRole; requires: readonly string[]; stamps: "submitted_at" | "closed_at" | null }> = {
  "required->submitted": { role: "writer", requires: CAP_SUBMISSION_FIELDS, stamps: "submitted_at" },
  "submitted->required": { role: "manager", requires: [], stamps: null },   // returned incomplete
  "submitted->approved": { role: "manager", requires: [], stamps: null },
  "approved->in_progress": { role: "manager", requires: [], stamps: null },
  "in_progress->closed": { role: "manager", requires: ["closure_note"], stamps: "closed_at" },
  "in_progress->failed": { role: "manager", requires: ["closure_note"], stamps: "closed_at" },
} as Record<string, { role: CapRole; requires: readonly string[]; stamps: "submitted_at" | "closed_at" | null }>;

export function capTransition(from: CapStatus, to: CapStatus, role: CapRole, fields: CapFields): CapTransition {
  const step = STEPS[`${from}->${to}`];
  if (!step) return { ok: false, error: `A Corrective Action Plan cannot go from ${from} to ${to}` };
  if (step.role === "manager" && role !== "manager") return { ok: false, error: `Only the Issuing Authority can move a plan to ${to}` };
  const missing = step.requires.filter(f => typeof fields[f as keyof CapFields] !== "string" || !String(fields[f as keyof CapFields]).trim());
  if (missing.length) return { ok: false, error: `Moving to ${to} requires ${missing.join(", ")}` };
  return { ok: true, sets: [...step.requires], stamps: step.stamps };
}

// Overdue is a state of a plan not yet submitted, not a property of a plan
// that was late once and has since moved on.
export function isCapOverdue(status: string, dueAt: Date | string, now: Date): boolean {
  return status === "required" && new Date(dueAt).getTime() < now.getTime();
}
