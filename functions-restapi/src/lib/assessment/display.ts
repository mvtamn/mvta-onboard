// What a scored standard's figure and target say in words.
//
// PeriodKpiAssessments.metric_display and target_display are what the
// scorecard, the standard's detail and the issued report print. Written at
// compute time as String(value) they read as "0.8362388553570882" against
// "Configured bands"; a contractor is owed "83.6%" against "85% or above".
// The unit is presentation, read live from the catalog rather than
// snapshotted, because it never enters scoring.

export type Direction = "higher_is_better" | "lower_is_better";

export interface DisplayStandard {
  standard_type: "occurrence" | "threshold";
  direction: Direction;
  unit_label: string | null;
  target_value: number | null;
  target_display: string | null;
}

export interface DisplayTier { tier_label: string; bound_low: number | null; bound_high: number | null }

const isRatioUnit = (unit: string | null) => unit === "percent" || unit === "%";

const NOUNS: Record<string, [string, string]> = {
  occurrences: ["occurrence", "occurrences"], miles: ["mile", "miles"], vehicles: ["vehicle", "vehicles"],
  "vehicle-days": ["vehicle-day", "vehicle-days"], days: ["day", "days"], weeks: ["week", "weeks"],
};

/** A value in its unit: "83.6%", "7 occurrences", "6,820 miles". */
export function formatQuantity(value: number, unit: string | null): string {
  if (isRatioUnit(unit)) return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  const text = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (!unit) return text;
  const noun = NOUNS[unit];
  return noun ? `${text} ${value === 1 ? noun[0] : noun[1]}` : `${text} ${unit}`;
}

// The standards whose hand-entered figure is one quantity over another, and
// what the two are called. The console's modules/assessment/ratioComponents.ts
// asks for the same two figures under the same names; the two lists are kept
// by hand because the API does not import console code.
const RATIO_COMPONENTS: Record<string, { numerator: string; denominator: string }> = {
  AVG_MILES_ROAD_CALLS: { numerator: "miles", denominator: "road calls" },
};

const whole = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * The working behind a ratio standard's figure: "412,300 miles ÷ 31 road
 * calls", or "412,300 miles, no road calls" when there was nothing to divide
 * by. Null for a standard entered whole or an entry saved without its parts.
 */
export function ratioWorking(standardCode: string, numerator: number | null | undefined, denominator: number | null | undefined): string | null {
  const parts = RATIO_COMPONENTS[standardCode];
  if (!parts || numerator === null || numerator === undefined || denominator === null || denominator === undefined) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return `${whole(numerator)} ${parts.numerator}, no ${parts.denominator}`;
  return `${whole(numerator)} ${parts.numerator} ÷ ${whole(denominator)} ${parts.denominator}`;
}

/** The month's figure, or "No data" when nothing measured it. */
export function metricDisplay(metricValue: number | null, standard: Pick<DisplayStandard, "standard_type" | "unit_label">, occurrenceCount: number): string {
  if (standard.standard_type === "occurrence") return formatQuantity(occurrenceCount, standard.unit_label ?? "occurrences");
  if (metricValue === null || !Number.isFinite(metricValue)) return "No data";
  return formatQuantity(metricValue, standard.unit_label);
}

/**
 * The target, in this order: the words the contract uses (target_display), the
 * stated target value with its direction, the Meets band's range, or an honest
 * "No target set" - never "Configured bands".
 */
export function targetDisplay(standard: DisplayStandard, tiers: readonly DisplayTier[]): string {
  const stated = standard.target_display?.trim();
  if (stated) return stated;
  const unit = standard.unit_label ?? (standard.standard_type === "occurrence" ? "occurrences" : null);
  if (standard.target_value !== null && Number.isFinite(standard.target_value)) {
    const value = formatQuantity(standard.target_value, unit);
    if (standard.target_value === 0 && standard.direction === "lower_is_better") return value;
    return standard.direction === "higher_is_better" ? `${value} or above` : `${value} or fewer`;
  }
  const meets = tiers.find((tier) => tier.tier_label === "meets");
  const counted = standard.standard_type === "occurrence" && !isRatioUnit(unit);
  if (meets) {
    // A count is met at whole numbers: a Meets band under 11 means ten or
    // fewer, and one under 1 means none at all.
    if (counted && !meets.bound_low && meets.bound_high !== null && Number.isInteger(meets.bound_high) && meets.bound_high >= 1) {
      const most = meets.bound_high - 1;
      return most === 0 ? formatQuantity(0, unit) : `${formatQuantity(most, unit)} or fewer`;
    }
    const low = meets.bound_low !== null ? formatQuantity(meets.bound_low, unit) : "";
    const high = meets.bound_high !== null ? formatQuantity(meets.bound_high, unit) : "";
    if (low && high) return `${low} to under ${high}`;
    if (low) return `${low} or above`;
    if (high) return `Under ${high}`;
  }
  // An occurrence standard with nothing stated is what the contract means by
  // it: the event is not supposed to happen. Fewer is better and none is the
  // target; only a standard that counts toward something says otherwise.
  if (counted && standard.direction === "lower_is_better") return formatQuantity(0, unit);
  return "No target set";
}
