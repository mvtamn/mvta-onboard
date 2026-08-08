export function consecutiveMonthsBelow(historyNewestFirst: readonly boolean[]): number {
  let count = 0;
  for (const below of historyNewestFirst) {
    if (!below) break;
    count += 1;
  }
  return count;
}

export function escalationMultiplier(consecutiveMonths: number): number {
  return consecutiveMonths >= 3 ? 1.5 : 1;
}

export interface CapTriggerInput {
  variancePct?: number | null;
  tierTriggersCap?: boolean;
  rollingOccurrenceCount?: number;
  rollingOccurrenceThreshold?: number;
}

export function capTriggers(input: CapTriggerInput): string[] {
  const reasons: string[] = [];
  if (input.variancePct !== null && input.variancePct !== undefined && input.variancePct < -10) {
    reasons.push("deviation_over_10pct");
  }
  if (input.tierTriggersCap) reasons.push("tier_rule");
  if (
    input.rollingOccurrenceCount !== undefined &&
    input.rollingOccurrenceThreshold !== undefined &&
    input.rollingOccurrenceCount > input.rollingOccurrenceThreshold
  ) reasons.push("rolling_window_rule");
  return reasons;
}
