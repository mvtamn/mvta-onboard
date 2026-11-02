// The vocabulary of a Procedure Revision's guidance, declared once.
//
// A Criterion's kind, an Immediate Action's kind, the severities, and the
// length of every guidance field were private constants inside
// decisionMatrixDrafts.ts while a hand-typed Draft was the only way to author
// one. Seeding a Draft from a QRG (qrgDraftSeed.ts) validates the same fields
// against the same rules, and a second copy of them would drift: the two
// paths would accept different guidance and only one of them would match the
// columns. So the rules live here and both paths read them.
//
// Lengths are the columns in migration 076, not opinions.

export const SEVERITIES: ReadonlySet<string> = new Set([
  "Stop service",
  "Restrict service",
  "Routine / no escalation",
]);

/** A Criterion either says when a Procedure applies, or when it does not. */
export const CRITERION_KINDS: ReadonlySet<string> = new Set(["applies", "excludes"]);

/** An Immediate Action is required, conditional on something, or informational. */
export const ACTION_KINDS: ReadonlySet<string> = new Set(["required", "conditional", "informational"]);

export const GUIDANCE_LIMITS = {
  condition: 200,
  severity_meaning: 300,
  criterion_text: 1000,
  action_instruction: 2000,
} as const;
