import type { StandardDirection, StandardTier } from "./types";

function inBand(tier: StandardTier, value: number): boolean {
  return (tier.boundLow === null || value >= tier.boundLow) &&
    (tier.boundHigh === null || value < tier.boundHigh);
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
