import type { PenaltyInput, StandardTier } from "./types";

function nonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error("Penalty quantities must be non-negative finite numbers.");
  return value;
}

export function computePenalty(tier: StandardTier, input: PenaltyInput = {}): number {
  const quantity = nonNegative(input.quantity, 1);
  const durationDays = nonNegative(input.durationDays, 1);
  const amount = nonNegative(tier.penaltyAmount, 0);

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
