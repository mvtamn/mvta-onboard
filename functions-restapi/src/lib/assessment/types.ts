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
  /** Rank when several bands match one observation; from the period's snapshot (migration 105). */
  severityOrder?: number | null;
  /**
   * A band whose amount the contract states as a RANGE rather than a figure -
   * damage reimbursement at $2,500-$10,000, say. Both set means a reviewer
   * enters the amount for each occurrence; penaltyAmount is not used.
   */
  penaltyAmountMin?: number | null;
  penaltyAmountMax?: number | null;
}

export interface PenaltyInput {
  quantity?: number;
  /** The reviewer's figure for this occurrence, on a ranged band. */
  assessedAmount?: number | null;
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
