export type StandardDirection = "higher_is_better" | "lower_is_better";
export type TierLabel = "meets" | "warning" | "tier1" | "tier2";
export type PenaltyBasis =
  | "none"
  | "flat"
  | "per_unit"
  | "per_unit_per_day"
  | "per_day"
  | "per_week";

export interface StandardTier {
  tierOrder: number;
  tierLabel: TierLabel;
  boundLow: number | null;
  boundHigh: number | null;
  qualifierCode?: string | null;
  penaltyBasis: PenaltyBasis;
  penaltyAmount: number;
  triggersCap?: boolean;
}

export interface PenaltyInput {
  quantity?: number;
  durationDays?: number;
}

export interface AssessmentSnapshot {
  standardCode: string;
  metricValue: number | null;
  quantity: number;
  occurrenceCount: number;
  durationDays: number | null;
  qualifierCode: string | null;
  reliefAmount: number;
  rampUpMultiplier: number;
  escalationMultiplier: number;
  sourceRefs: string[];
}
