import type { ContractorPerformanceStandard, ContractorStandardTier, PeriodKpiAssessment } from "@mvta/shared";
import { describeRange, isRatioUnit, unitNoun } from "../../performanceStandardsVocabulary.js";

// What a scorecard row says for its figure and its target.
//
// Since the compute step started writing readable strings, a row carries
// "83.6%" against "85% or above" and these pass it through. Rows computed
// before that carry String(value) - "0.8362388553570882" - and the literal
// "Configured bands"; those are formatted here from the catalog's unit and
// ladder, so a month does not have to be recomputed to read properly.

const PLACEHOLDER_TARGETS = new Set(["", "configured bands", "configured tiers"]);
const numeric = /^-?\d+(\.\d+)?$/;

function quantity(value: number, unit: string): string {
  if (isRatioUnit(unit)) return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  const text = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit ? `${text} ${value === 1 ? unitNoun(unit) : unit}` : text;
}

/** The month's figure in its unit. */
export function metricText(row: Pick<PeriodKpiAssessment, "metric_display" | "standard_type" | "occurrence_count">, standard: Pick<ContractorPerformanceStandard, "unit_label"> | undefined): string {
  const raw = (row.metric_display ?? "").trim();
  if (!numeric.test(raw)) return raw || "No data";
  if (row.standard_type === "occurrence") return quantity(row.occurrence_count, standard?.unit_label || "occurrences");
  return standard ? quantity(Number(raw), standard.unit_label) : raw;
}

/** The target, never the compute step's old "Configured bands" placeholder. */
export function targetText(
  row: Pick<PeriodKpiAssessment, "target_display" | "standard_type">,
  standard: Pick<ContractorPerformanceStandard, "unit_label" | "direction" | "target_value" | "target_display"> | undefined,
  ladder: readonly Pick<ContractorStandardTier, "tier_label" | "bound_low" | "bound_high">[],
): string {
  const stored = (row.target_display ?? "").trim();
  if (!PLACEHOLDER_TARGETS.has(stored.toLowerCase()) && !numeric.test(stored)) return stored;
  const stated = standard?.target_display?.trim();
  if (stated) return stated;
  const unit = standard?.unit_label || (row.standard_type === "occurrence" ? "occurrences" : "");
  const value = standard?.target_value ?? (numeric.test(stored) ? Number(stored) : null);
  if (value !== null && value !== undefined && Number.isFinite(value)) {
    const text = quantity(value, unit);
    if (value === 0 && standard?.direction !== "higher_is_better") return text;
    return standard?.direction === "higher_is_better" ? `${text} or above` : `${text} or fewer`;
  }
  const meets = ladder.find((tier) => tier.tier_label === "meets");
  const range = meets && unit ? describeRange(meets, unit) : "Any measured value";
  return range === "Any measured value" ? "No target set" : range;
}
