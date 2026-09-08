import type {
  CapWindowMode, ContractorPerformanceStandard, ContractorStandardTier, ReferenceValue,
  StandardMeasurementSource, StandardPenaltyBasis,
} from "@mvta/shared";

// Turning the tier model into words, and back.
//
// A band is stored as two nullable bounds and an optional qualifier, matched by
// lib/assessment/tiers.ts as `value >= bound_low && value < bound_high`. Two
// things follow that the raw numbers hide, and that an administrator editing a
// penalty band has to be able to see:
//
//   bound_low is INCLUSIVE and bound_high is EXCLUSIVE. The seeded
//   OPERATOR_CONDUCT "meets" band is bound_high = 11, so it is met at ten
//   complaints and missed at eleven - which two number boxes labelled From and
//   To do not tell anyone.
//
//   Bounds and qualifier are independent. matchTier prefers a band whose
//   qualifier matches the occurrence and otherwise takes the first unqualified
//   band in range, so "which values" and "which occurrences" are separate
//   questions and are edited as separate controls here.
//
// Percentages are stored as ratios because that is what the resolvers compute;
// they are shown and entered as percent, converted only at this boundary.

export type BandRange = "any" | "at_or_above" | "under" | "between";

export const TIER_LABELS = [
  { value: "meets", label: "Meets the standard" },
  { value: "warning", label: "Warning" },
  { value: "tier1", label: "Tier 1 penalty" },
  { value: "tier2", label: "Tier 2 penalty" },
] as const;

export const PENALTY_BASES: { value: StandardPenaltyBasis; label: string; hint: string }[] = [
  { value: "none", label: "No penalty", hint: "The band is recorded but charges nothing." },
  { value: "flat", label: "Flat amount for the month", hint: "Charged once, however many times it happened." },
  { value: "per_unit", label: "Per occurrence", hint: "Multiplied by the number of occurrences." },
  { value: "per_unit_per_day", label: "Per occurrence, per day", hint: "Multiplied by occurrences and by how many days each lasted." },
  { value: "per_day", label: "Per day", hint: "Multiplied by how many days it lasted." },
  { value: "per_week", label: "Per occurrence, per week", hint: "Multiplied by occurrences and by each started week." },
];

// The units the Attachment G catalog actually uses (migration 030), offered as
// a picker rather than a free-text box so a typo cannot quietly create a
// second unit that formats differently everywhere it appears.
export const CATALOG_UNITS = [
  { value: "percent", label: "Percent (%)" },
  { value: "occurrences", label: "Occurrences" },
  { value: "miles", label: "Miles" },
  { value: "vehicles", label: "Vehicles" },
  { value: "vehicle-days", label: "Vehicle-days" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
] as const;

export const isRatioUnit = (unit: string) => unit === "percent" || unit === "%";

// Singular noun for a unit, for phrases like "$1,000 per occurrence".
const UNIT_NOUNS: Record<string, string> = {
  occurrences: "occurrence", miles: "mile", vehicles: "vehicle",
  "vehicle-days": "vehicle", days: "day", weeks: "week", percent: "percentage point",
};
export const unitNoun = (unit: string) => UNIT_NOUNS[unit] ?? unit.replace(/s$/, "");

export function formatBound(value: number | null, unit: string): string {
  if (value === null) return "";
  const shown = isRatioUnit(unit) ? Number((value * 100).toFixed(4)) : value;
  const text = shown.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return isRatioUnit(unit) ? `${text}%` : `${text} ${unit}`;
}

export function boundToInput(value: number | null, unit: string): string {
  if (value === null) return "";
  return String(isRatioUnit(unit) ? Number((value * 100).toFixed(4)) : value);
}

export function inputToBound(value: string, unit: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return isRatioUnit(unit) ? parsed / 100 : parsed;
}

export function bandRangeOf(tier: Pick<ContractorStandardTier, "bound_low" | "bound_high">): BandRange {
  if (tier.bound_low === null && tier.bound_high === null) return "any";
  if (tier.bound_high === null) return "at_or_above";
  if (tier.bound_low === null) return "under";
  return "between";
}

export const BAND_RANGES: { value: BandRange; label: string }[] = [
  { value: "any", label: "Any measured value" },
  { value: "at_or_above", label: "At or above…" },
  { value: "under", label: "Under…" },
  { value: "between", label: "From … to under …" },
];

// Which bound inputs a given range needs. Switching range clears the bounds it
// no longer uses, so a leftover number cannot silently keep narrowing a band
// the administrator believes they widened.
export function boundsForRange(range: BandRange, low: number | null, high: number | null): { bound_low: number | null; bound_high: number | null } {
  switch (range) {
    case "any": return { bound_low: null, bound_high: null };
    case "at_or_above": return { bound_low: low, bound_high: null };
    case "under": return { bound_low: null, bound_high: high };
    case "between": return { bound_low: low, bound_high: high };
  }
}

// The band's value range, in words. Says "under" and "or above" rather than
// showing bare numbers, because the exclusive upper bound is the part people
// get wrong.
export function describeRange(tier: Pick<ContractorStandardTier, "bound_low" | "bound_high">, unit: string): string {
  const low = formatBound(tier.bound_low, unit);
  const high = formatBound(tier.bound_high, unit);
  if (!low && !high) return "Any measured value";
  if (!high) return `${low} or above`;
  if (!low) return `Under ${high}`;
  return `${low} to under ${high}`;
}

export function describePenalty(
  tier: Pick<ContractorStandardTier, "penalty_basis" | "penalty_amount">,
  unit: string,
): string {
  if (tier.penalty_basis === "none") return "no penalty";
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    .format(Number(tier.penalty_amount));
  const noun = unitNoun(unit);
  switch (tier.penalty_basis) {
    case "flat": return `${money} for the month`;
    case "per_unit": return `${money} per ${noun}`;
    case "per_unit_per_day": return `${money} per ${noun}, per day`;
    case "per_day": return `${money} per day`;
    case "per_week": return `${money} per ${noun}, per week`;
    default: return money;
  }
}

export function qualifierLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return code.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

// One band as a sentence: what it covers, and what it costs.
export function describeBand(
  tier: Pick<ContractorStandardTier, "bound_low" | "bound_high" | "penalty_basis" | "penalty_amount" | "qualifier_code" | "triggers_cap">,
  standard: Pick<ContractorPerformanceStandard, "unit_label" | "standard_type">,
): string {
  const unit = standard.unit_label;
  // An occurrence standard is matched per event, so an unbounded band means
  // "every one of them" rather than "any measured value" - the same two NULLs,
  // but a different sentence, and the occurrence reading is the one an
  // administrator is checking.
  const scope = standard.standard_type === "occurrence" && tier.bound_low === null && tier.bound_high === null
    ? `Every ${unitNoun(unit)}`
    : describeRange(tier, unit);
  const only = qualifierLabel(tier.qualifier_code);
  const parts = [only ? `${scope}, only when: ${only}` : scope, describePenalty(tier, unit)];
  if (tier.triggers_cap) parts.push("requires a corrective action plan");
  return parts.join(" → ").replace(" → requires", " · requires");
}

// Gaps and overlaps a ladder can carry. Not blocking - Attachment G's own
// bands are not always contiguous, and a deliberate gap is a legitimate
// choice - but an unintended one silently scores a month at the wrong tier,
// so it is named before the ladder is saved rather than discovered afterwards.
export function ladderWarnings(
  tiers: Pick<ContractorStandardTier, "bound_low" | "bound_high" | "qualifier_code" | "tier_label">[],
  unit: string,
): string[] {
  const warnings: string[] = [];
  const ranged = tiers
    .map((tier, index) => ({ tier, index }))
    .filter(({ tier }) => !tier.qualifier_code && (tier.bound_low !== null || tier.bound_high !== null))
    .sort((a, b) => (a.tier.bound_low ?? -Infinity) - (b.tier.bound_low ?? -Infinity));

  for (let i = 0; i < ranged.length - 1; i += 1) {
    const current = ranged[i].tier;
    const next = ranged[i + 1].tier;
    if (current.bound_high === null) continue;
    if (next.bound_low === null) continue;
    if (next.bound_low > current.bound_high) {
      warnings.push(`Nothing scores between ${formatBound(current.bound_high, unit)} and ${formatBound(next.bound_low, unit)}.`);
    } else if (next.bound_low < current.bound_high) {
      warnings.push(`${formatBound(next.bound_low, unit)} to ${formatBound(current.bound_high, unit)} matches two bands; the earlier one wins.`);
    }
  }

  const unqualifiedAny = tiers.filter((tier) => !tier.qualifier_code && tier.bound_low === null && tier.bound_high === null);
  if (unqualifiedAny.length > 1) {
    warnings.push("More than one band matches any value; only the first will ever score.");
  }
  return warnings;
}

// How a standard's source reads in the catalog. Short, because it sits in a
// list row beside everything else about the standard.
export const MEASUREMENT_SOURCE_LABELS: Record<StandardMeasurementSource, string> = {
  api_feed: "from a feed",
  onboard_compliance: "from OnBoard",
  manual_entry: "by hand",
  structured_import: "transcribed",
};

export function sourceLabel(source: StandardMeasurementSource | undefined, sourceSystem?: string | null): string {
  const base = MEASUREMENT_SOURCE_LABELS[source ?? "manual_entry"];
  return source === "structured_import" && sourceSystem ? `from ${sourceSystem}` : base;
}

// Whether anything measures this standard without a person typing the figure.
// Only these two kinds name a resolver, so only they can be missing one.
export function isAutomated(source: StandardMeasurementSource | undefined): boolean {
  return source === "api_feed" || source === "onboard_compliance";
}

// Whether a person types this standard's monthly figure. Both manual kinds do:
// the difference between them is provenance, not mechanism, so anything that
// offers an entry form has to include both - otherwise reclassifying a
// standard as transcribed from Nexus or M5 would quietly remove it from the
// form somebody enters it on.
export function isHandEntered(source: StandardMeasurementSource | undefined): boolean {
  return !isAutomated(source);
}

// --- the vocabulary, read from the database ---
//
// Every picker in the configurator draws its options from ReferenceValues
// (migration 105) rather than from a literal array, so MVTA can rename a tier
// to whatever the contract calls it, hide the units it does not use, and add a
// source system without a deploy.
//
// The built-in lists survive as the fallback for an environment where the
// migration has not run: the page still renders every picker, using the code's
// own words. That is the same degrade-before-the-migration pattern the
// agreement scoping and the resolver snapshot use.

export interface VocabularyOption {
  value: string;
  label: string;
  description?: string | null;
  /** tier_label only: which tier outranks which when several bands match. */
  severityOrder?: number | null;
}

export function optionsFor(
  values: ReferenceValue[],
  domain: string,
  fallback: readonly VocabularyOption[],
): VocabularyOption[] {
  const rows = values
    .filter((row) => row.domain === domain && row.is_active)
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label));
  if (!rows.length) return [...fallback];
  return rows.map((row) => ({
    value: row.value, label: row.label, description: row.description, severityOrder: row.severity_order,
  }));
}

// A value that has been retired, or renamed since a record used it, still has
// to render wherever it was used - so a picker showing a stored value includes
// it even when it is no longer offered for new records.
export function withCurrent(options: VocabularyOption[], current: string | null | undefined): VocabularyOption[] {
  if (!current || options.some((option) => option.value === current)) return options;
  return [...options, { value: current, label: `${current} (retired)` }];
}

export const FALLBACK_UNITS: readonly VocabularyOption[] = CATALOG_UNITS.map((unit) => ({ value: unit.value, label: unit.label }));
export const FALLBACK_PENALTY_BASES: readonly VocabularyOption[] = PENALTY_BASES.map((basis) => ({ value: basis.value, label: basis.label, description: basis.hint }));
export const FALLBACK_TIER_LABELS: readonly VocabularyOption[] = TIER_LABELS.map((tier, index) => ({ value: tier.value, label: tier.label, severityOrder: index }));
export const FALLBACK_PRIORITIES: readonly VocabularyOption[] = [
  { value: "High", label: "High" }, { value: "Medium", label: "Medium" },
  { value: "Low", label: "Low" }, { value: "NA", label: "Not applicable" },
];


// The corrective-action window read back as the sentence it means.
//
// Three fields describe one rule, and the two modes differ in a way the fields
// do not show: a rolling window never resets, a calendar quarter resets on 1
// January, 1 April, 1 July and 1 October. An administrator choosing between
// them is choosing what happens to a count that straddles a quarter boundary,
// so the sentence says so rather than repeating the numbers back.
export function capWindowSentence(standard: {
  cap_window_mode?: CapWindowMode | null;
  cap_window_days?: number | null;
  cap_window_threshold?: number | null;
}): string {
  const mode = standard.cap_window_mode;
  if (!mode) return "No corrective action window: occurrences are charged as they happen.";
  const threshold = standard.cap_window_threshold;
  const count = typeof threshold === "number" && threshold > 0
    ? `More than ${threshold} ${threshold === 1 ? "occurrence" : "occurrences"}`
    : "Once the threshold is set, more occurrences than it allows";
  if (mode === "calendar_quarter") {
    return `${count} within one calendar quarter owes corrective action. The count restarts on 1 January, 1 April, 1 July and 1 October.`;
  }
  const days = standard.cap_window_days;
  if (typeof days !== "number" || days < 1) {
    return `${count} within a rolling window owes corrective action. Set the number of days the window covers.`;
  }
  return `${count} in any ${days} consecutive days owes corrective action. The window never resets, so a count can straddle a month or a quarter.`;
}

// What a report shows for the target when nobody has written a phrase for it.
//
// assess.ts falls back to String(target_value) and then to "Configured bands",
// so an 85% target reads as "0.85" on an issued report unless somebody says
// otherwise. This is what the editor offers as the placeholder, formatted the
// way every other figure on the page is - which is usually enough, and makes
// the cases that need words ("Under 11 a month") the ones somebody types.
export function defaultTargetDisplay(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return formatBound(value, unit);
}
