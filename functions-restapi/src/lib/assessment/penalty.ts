import type { PenaltyInput, StandardTier } from "./types";

function nonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error("Penalty quantities must be non-negative finite numbers.");
  return value;
}

// A band whose amount the contract states as a range, not a figure. The rule
// sets the bounds; a person sets the number on the facts of the occurrence.
export function isRangedBand(tier: Pick<StandardTier, "penaltyAmountMin" | "penaltyAmountMax">): boolean {
  return tier.penaltyAmountMin !== null && tier.penaltyAmountMin !== undefined
    && tier.penaltyAmountMax !== null && tier.penaltyAmountMax !== undefined;
}

// What one occurrence costs, or null when it is waiting on a reviewer.
//
// Returning null rather than 0 is the point: a ranged band with no figure yet
// is UNKNOWN, and scoring it as nothing would put a $0 line on a report where
// the contract says between $2,500 and $10,000 is owed.
export function bandAmount(
  tier: Pick<StandardTier, "penaltyAmount" | "penaltyAmountMin" | "penaltyAmountMax">,
  assessedAmount?: number | null,
): number | null {
  if (!isRangedBand(tier)) return nonNegative(tier.penaltyAmount, 0);
  if (assessedAmount === null || assessedAmount === undefined) return null;
  const amount = nonNegative(assessedAmount, 0);
  // The contract's bounds are the contract's; a figure outside them is a
  // mistake worth refusing rather than quietly clamping into range.
  if (amount < (tier.penaltyAmountMin ?? 0) || amount > (tier.penaltyAmountMax ?? 0)) {
    throw new Error(`Assessed amount ${amount} is outside the band's ${tier.penaltyAmountMin}-${tier.penaltyAmountMax} range.`);
  }
  return amount;
}

export function computePenalty(tier: StandardTier, input: PenaltyInput = {}): number {
  const quantity = nonNegative(input.quantity, 1);
  const durationDays = nonNegative(input.durationDays, 1);
  const resolved = bandAmount(tier, input.assessedAmount);
  // An unresolved ranged band contributes nothing to the running total; the
  // caller counts it as awaiting instead, which is what stops the month
  // reading as complete.
  if (resolved === null) return 0;
  const amount = resolved;

  switch (tier.penaltyBasis) {
    case "none": return 0;
    case "flat": return amount;
    case "per_unit": return amount * quantity;
    case "per_unit_per_day": return amount * quantity * durationDays;
    case "per_day": return amount * durationDays;
    case "per_week": return amount * quantity * Math.ceil(durationDays / 7);
    default: {
      const exhaustive: never = tier.penaltyBasis;
      throw new Error(`Unsupported penalty basis: ${exhaustive}`);
    }
  }
}
