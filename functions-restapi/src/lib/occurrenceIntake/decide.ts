// The intake rules as pure decisions over facts the store loads. The SQL in
// assignment.ts computes the IntakeState; these decide what a single write
// does with it.
import type { AttributionAuthority, IntakeRefusal, IntakeRefusalCode, IntakeState, OccurrenceAttribution, OccurrenceReviewStatus } from "./types";

export const REFUSAL_SENTENCES: Record<IntakeRefusalCode, string> = {
  unassigned: "No single active Performance Agreement covers this service date, so the occurrence has no Assessment Contractor.",
  standard_not_scored: "This standard is not scored on the Agreement that covers this service date.",
  period_closed: "That month's assessment is finalized or issued. Reopen the period to change it.",
  contractor_mismatch: "The contractor does not match the Agreement that covers this service date.",
  relief_mismatch: "The claim must belong to the same contractor and month, and not be denied.",
  amount_outside_band: "The amount is outside the range the contract sets for this penalty.",
  not_found: "The occurrence was not found.",
  schema_not_ready: "The performance assessment tables are not available in this environment.",
  attribution_authority: "Recording this attribution needs an authority you do not hold.",
  not_attributable: "This occurrence was reviewed as not having happened, so there is nothing to attribute. Reopen it first.",
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

// Service attribution (plan step 0.8, ADR 0048).
//
// MVTA, 2026-11-06: "A transportation specialist reviews, managers decide
// attribution, the COO decides if it is excusable." So the outcome, the
// attribution and the excusable decision are three acts by three authorities.
// The review states what happened and never sets attribution; a confirmed
// trip's occurrence waits as an `undetermined` candidate, which counts for
// nothing, until a manager attributes it.

// What an occurrence's status is once it carries an attribution. Only
// contractor error is charged; excusable and MVTA-directed are recorded
// against the month without a penalty, which is what `dismissed` with an
// attribution has always meant here.
export function reviewStatusFor(attribution: OccurrenceAttribution): OccurrenceReviewStatus {
  if (attribution === "contractor_error") return "confirmed";
  if (attribution === "undetermined") return "candidate";
  return "dismissed";
}

// The authority a change of attribution needs. Excusable on either side is the
// COO's: deciding it, and undoing it. Everything else is a manager's.
export function attributionAuthorityNeeded(from: OccurrenceAttribution, to: OccurrenceAttribution): "attribute" | "excuse" {
  return from === "excusable" || to === "excusable" ? "excuse" : "attribute";
}

export interface AttributionFacts {
  periodStatus: string | null;
  reviewStatus: OccurrenceReviewStatus;
  attribution: OccurrenceAttribution;
}

export function decideAttribution(
  existing: AttributionFacts | null,
  to: OccurrenceAttribution,
  held: AttributionAuthority,
): IntakeRefusal | null {
  const refused = decideChange(existing);
  if (refused || !existing) return refused;
  // Dismissed with no attribution is a reviewer saying it did not happen.
  if (existing.reviewStatus === "dismissed" && existing.attribution === "undetermined") return refusal("not_attributable");
  const needed = attributionAuthorityNeeded(existing.attribution, to);
  if (!held[needed]) {
    return refusal("attribution_authority", needed === "excuse"
      ? "Only the Excusability Authority (the COO) can decide that an occurrence was excusable, or change one that was."
      : "Recording contractor error or MVTA-directed needs the attribution authority a manager holds.");
  }
  return null;
}

// What a missed-trip review does to the occurrence it raises or restates. A
// review that is not a confirmation dismisses it and clears any attribution:
// there is nothing to attribute. A confirmation leaves an attribution already
// decided where it stands - a reviewer restating the outcome does not undo a
// manager's or the COO's decision - and otherwise raises a candidate.
export function reviewHandOffState(
  confirmed: boolean,
  existing: { reviewStatus: OccurrenceReviewStatus; attribution: OccurrenceAttribution } | null,
): { review_status: OccurrenceReviewStatus; attribution: OccurrenceAttribution } {
  if (!confirmed) return { review_status: "dismissed", attribution: "undetermined" };
  if (existing && existing.attribution !== "undetermined") {
    return { review_status: reviewStatusFor(existing.attribution), attribution: existing.attribution };
  }
  return { review_status: "candidate", attribution: "undetermined" };
}
