// Every check the review runs, in the order the table shows them. Thresholds
// were set against the 20260909 MVTA feed so that each flags the routes it
// should and leaves the rest alone; they are a starting point to tune once
// OnBoard measures prediction accuracy itself.
import type { PredictionRiskCheckDefinition } from "../types";
import type { CheckModule } from "./check";
import { placeholderTimes } from "./placeholderTimes";
import { timepointGap } from "./timepointGap";
import { longestHop } from "./longestHop";
import { tightTurnarounds } from "./tightTurnarounds";
import { interlined } from "./interlined";
import { blockOverlaps } from "./blockOverlaps";
import { runTimeSpread } from "./runTimeSpread";
import { runTimeFlat } from "./runTimeFlat";
import { timepointDensity } from "./timepointDensity";
import { impliedSpeed } from "./impliedSpeed";
import { recoveryTime } from "./recoveryTime";

export const CHECKS: readonly CheckModule[] = [
  placeholderTimes,
  timepointGap,
  longestHop,
  tightTurnarounds,
  interlined,
  blockOverlaps,
  runTimeSpread,
  runTimeFlat,
  timepointDensity,
  impliedSpeed,
  recoveryTime,
];

export const PREDICTION_RISK_CHECKS: readonly PredictionRiskCheckDefinition[] = CHECKS.map((c) => c.definition);

export function isFlagged(definition: PredictionRiskCheckDefinition, value: number | null): boolean {
  if (value === null) return false;
  return definition.comparison === "at_most" ? value <= definition.threshold : value >= definition.threshold;
}

export type { CheckModule, CheckOutcome } from "./check";
