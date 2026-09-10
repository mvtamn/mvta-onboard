import type { ContractorPerformanceStandard } from "@mvta/shared";

// A standard whose monthly figure is one quantity divided by another.
//
// Average Miles Between Road Calls is the miles the fleet ran in the month
// over the chargeable road calls it had. Typing the finished quotient asked
// the owner to do the division at their desk and left the issued report
// with a figure the contractor could not check. The form asks for the two
// quantities and does the arithmetic; the row keeps both so the report can
// show its working.
//
// Keyed by standard code because the catalog has no column that says a
// figure is a ratio, and adding one for a single standard would be a schema
// change in search of a second case. When one arrives, add it here.

export interface RatioComponent {
  /** What the field asks for: "Miles operated". */
  label: string;
  /** The unit shown beside it: "miles". */
  unit: string;
}

export interface RatioComponents {
  numerator: RatioComponent;
  denominator: RatioComponent;
}

const BY_CODE: Record<string, RatioComponents> = {
  AVG_MILES_ROAD_CALLS: {
    numerator: { label: "Miles operated", unit: "miles" },
    denominator: { label: "Chargeable road calls", unit: "road calls" },
  },
};

/** The two figures a standard is entered as, or null when it is typed whole. */
export function ratioComponents(standard: Pick<ContractorPerformanceStandard, "code">): RatioComponents | null {
  return BY_CODE[standard.code] ?? null;
}

/**
 * The figure the two parts make, or null when they cannot make one.
 *
 * A month with no road calls has no quotient. The miles it ran without one
 * are a floor on the distance between them, so that is the figure recorded:
 * the fleet went at least that far. It is far above any target a contract
 * states, which is what a month with no failures deserves.
 */
export function ratioValue(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator < 0 || denominator < 0) return null;
  if (denominator === 0) return numerator;
  return Math.round(numerator / denominator);
}

const whole = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** "412,300 miles ÷ 31 road calls", or "412,300 miles, no road calls". */
export function ratioText(components: RatioComponents, numerator: number, denominator: number): string {
  if (denominator === 0) return `${whole(numerator)} ${components.numerator.unit}, no ${components.denominator.unit}`;
  return `${whole(numerator)} ${components.numerator.unit} ÷ ${whole(denominator)} ${components.denominator.unit}`;
}
