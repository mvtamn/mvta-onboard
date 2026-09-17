// The intake rules as pure decisions over facts the store loads. The SQL in
// assignment.ts computes the IntakeState; these decide what a single write
// does with it.
import type { IntakeRefusal, IntakeRefusalCode, IntakeState, OccurrenceAttribution, OccurrenceReviewStatus } from "./types";

export const REFUSAL_SENTENCES: Record<IntakeRefusalCode, string> = {
  unassigned: "No single active Performance Agreement covers this service date, so the occurrence has no Assessment Contractor.",
  standard_not_scored: "This standard is not scored on the Agreement that covers this service date.",
  period_closed: "That month's assessment is finalized or issued. Reopen the period to change it.",
  contractor_mismatch: "The contractor does not match the Agreement that covers this service date.",
  relief_mismatch: "The claim must belong to the same contractor and month, and not be denied.",
  amount_outside_band: "The amount is outside the range the contract sets for this penalty.",
  not_found: "The occurrence was not found.",
  schema_not_ready: "The performance assessment tables are not available in this environment.",
};

export function refusal(code: IntakeRefusalCode, sentence = REFUSAL_SENTENCES[code]): IntakeRefusal {
  return { code, sentence };
}

// A closed month is refused whether the write is new or a change.
export const CLOSED_PERIOD_STATUSES = ["finalized", "issued"] as const;

export function isClosedPeriod(status: string | null | undefined): boolean {
  return status === "finalized" || status === "issued";
}

// A new occurrence is written only when intake accepts it.
export function decideNew(state: IntakeState): IntakeRefusal | null {
  return state === "accepted" ? null : refusal(state);
}

export interface ManualFacts {
  state: IntakeState | null; // null: the standard does not exist
  assignedContractorId: string | null;
  requestedContractorId?: string | null;
}

export function decideManual(facts: ManualFacts): IntakeRefusal | null {
  if (facts.state === null) return refusal("standard_not_scored", "That performance standard does not exist.");
  const refused = decideNew(facts.state);
  if (refused) return refused;
  if (facts.requestedContractorId && facts.assignedContractorId
    && facts.requestedContractorId.toLowerCase() !== facts.assignedContractorId.toLowerCase()) return refusal("contractor_mismatch");
  return null;
}

// A change to an occurrence that exists. It already has its contractor, so
// only its own month's state matters: an Agreement edited since does not stop
// a reviewer dismissing it.
export function decideChange(existing: { periodStatus: string | null } | null): IntakeRefusal | null {
  if (!existing) return refusal("not_found");
  if (isClosedPeriod(existing.periodStatus)) return refusal("period_closed");
  return null;
}

export function decideAmount(
  existing: { periodStatus: string | null; minAmount: number | null; maxAmount: number | null } | null,
  amount: number | null,
): IntakeRefusal | null {
  const refused = decideChange(existing);
  if (refused || amount === null || !existing) return refused;
  if (existing.minAmount !== null && existing.maxAmount !== null && (amount < existing.minAmount || amount > existing.maxAmount)) {
    return refusal("amount_outside_band", `The contract sets this penalty between ${existing.minAmount} and ${existing.maxAmount}. ${amount} is outside that range.`);
  }
  return null;
}

// How a missed-trip review answer becomes an occurrence's state.
//
// `undetermined` is not a refusal to decide - it is the reviewer saying the
// attribution needs a separate look, which is exactly what the Assessment
// module's occurrence queue is for. It stays a candidate there.
export function occurrenceStateFor(
  validationStatus: "confirmed" | "false_positive",
  attribution: OccurrenceAttribution,
): { review_status: OccurrenceReviewStatus; attribution: OccurrenceAttribution } {
  if (validationStatus === "false_positive") return { review_status: "dismissed", attribution: "undetermined" };
  if (attribution === "contractor_error") return { review_status: "confirmed", attribution };
  if (attribution === "undetermined") return { review_status: "candidate", attribution };
  return { review_status: "dismissed", attribution };
}
