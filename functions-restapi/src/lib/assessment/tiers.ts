import type { StandardDirection, StandardTier } from "./types";

function inBand(tier: StandardTier, value: number): boolean {
  return (tier.boundLow === null || value >= tier.boundLow) &&
    (tier.boundHigh === null || value < tier.boundHigh);
}

// Which value a band is matched against.
//
// per_occurrence  the occurrence's own quantity - the original behaviour.
// running_count   its ordinal position within the service month, so a band
//                 bounded 13 to 16 means "the thirteenth through fifteenth
//                 occurrence of the month", which is how the contract's
//                 count-scaled penalties actually read. Matching a band like
//                 that against a single occurrence's quantity compared 13
//                 against 1 and never fired.
export function bandMatchValue(
  scope: "per_occurrence" | "running_count",
  occurrenceQuantity: number,
  ordinalInPeriod: number,
): number {
  return scope === "running_count" ? ordinalInPeriod : occurrenceQuantity;
}

export function matchTier(
  tiers: readonly StandardTier[],
  value: number,
  _direction: StandardDirection,
  qualifier?: string | null,
): StandardTier | null {
  if (!Number.isFinite(value)) return null;

  const ordered = [...tiers].sort((a, b) => a.tierOrder - b.tierOrder);
  if (qualifier) {
    const qualified = ordered.find(
      (tier) => tier.qualifierCode === qualifier && inBand(tier, value),
    );
    if (qualified) return qualified;
  }

  return ordered.find((tier) => !tier.qualifierCode && inBand(tier, value)) ?? null;
}
