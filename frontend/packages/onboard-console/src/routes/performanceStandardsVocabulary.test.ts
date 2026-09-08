import { describe, expect, it } from "vitest";
import type { AssessmentTierLabel } from "@mvta/shared";
import {
  bandRangeOf, boundsForRange, boundToInput, capWindowSentence, defaultTargetDisplay, describeBand, describePenalty, describeRange,
  inputToBound, ladderWarnings, qualifierLabel, unitNoun,
} from "./performanceStandardsVocabulary.js";

const band = (over: Partial<Parameters<typeof describeBand>[0]> = {}) => ({
  bound_low: null, bound_high: null, qualifier_code: null,
  penalty_basis: "none" as const, penalty_amount: 0, triggers_cap: false, ...over,
});
const threshold = (unit: string) => ({ unit_label: unit, standard_type: "threshold" as const });
const occurrence = (unit: string) => ({ unit_label: unit, standard_type: "occurrence" as const });

describe("reading a band the way tiers.ts matches it", () => {
  it("says the upper bound is exclusive, because it is", () => {
    // matchTier is `value >= bound_low && value < bound_high`. The seeded
    // OPERATOR_CONDUCT "meets" band is bound_high 11, so eleven complaints
    // miss the standard - which "From – To 11" never told anyone.
    expect(describeRange({ bound_low: null, bound_high: 11 }, "occurrences")).toBe("Under 11 occurrences");
    expect(describeRange({ bound_low: 11, bound_high: 13 }, "occurrences")).toBe("11 occurrences to under 13 occurrences");
    expect(describeRange({ bound_low: 16, bound_high: null }, "occurrences")).toBe("16 occurrences or above");
    expect(describeRange({ bound_low: null, bound_high: null }, "occurrences")).toBe("Any measured value");
  });

  it("shows percentage bands as percentages, though they are stored as ratios", () => {
    // The Attachment G OTP ladder, exactly as migration 030 seeds it.
    expect(describeRange({ bound_low: 0.85, bound_high: null }, "percent")).toBe("85% or above");
    expect(describeRange({ bound_low: 0.8, bound_high: 0.85 }, "percent")).toBe("80% to under 85%");
    expect(describeRange({ bound_low: null, bound_high: 0.75 }, "percent")).toBe("Under 75%");
  });

  it("reads an unbounded occurrence band as every event, not as any value", () => {
    // Same two NULLs, different question: an occurrence standard is matched
    // per event, so "any measured value" would be a category error.
    expect(describeBand(band({ penalty_basis: "per_unit", penalty_amount: 1000 }), occurrence("occurrences")))
      .toBe("Every occurrence → $1,000 per occurrence");
    expect(describeBand(band(), threshold("percent"))).toBe("Any measured value → no penalty");
  });

  it("spells out what each penalty basis multiplies by", () => {
    expect(describePenalty({ penalty_basis: "flat", penalty_amount: 3500 }, "percent")).toBe("$3,500 for the month");
    expect(describePenalty({ penalty_basis: "per_unit", penalty_amount: 250 }, "occurrences")).toBe("$250 per occurrence");
    // SHUTDOWN_VEHICLE: per_unit_per_day, measured in vehicle-days.
    expect(describePenalty({ penalty_basis: "per_unit_per_day", penalty_amount: 1000 }, "vehicle-days")).toBe("$1,000 per vehicle, per day");
    expect(describePenalty({ penalty_basis: "none", penalty_amount: 0 }, "miles")).toBe("no penalty");
  });

  it("names the condition a qualified band narrows to", () => {
    // MISSED_TRIPS_FR tier 2, the doubled last-trip band.
    expect(describeBand(band({ qualifier_code: "LAST_TRIP_OF_DAY", penalty_basis: "per_unit", penalty_amount: 2000 }), occurrence("occurrences")))
      .toBe("Every occurrence, only when: Last trip of day → $2,000 per occurrence");
    expect(qualifierLabel("REPORTING_LATE")).toBe("Reporting late");
    expect(qualifierLabel(null)).toBeNull();
  });

  it("flags a band that forces a corrective action plan", () => {
    expect(describeBand(band({ bound_low: 16, triggers_cap: true, penalty_basis: "per_unit", penalty_amount: 250 }), threshold("occurrences")))
      .toContain("requires a corrective action plan");
  });
});

describe("editing a band by criteria", () => {
  it("recognises which criteria a stored band is using", () => {
    expect(bandRangeOf({ bound_low: null, bound_high: null })).toBe("any");
    expect(bandRangeOf({ bound_low: 0.85, bound_high: null })).toBe("at_or_above");
    expect(bandRangeOf({ bound_low: null, bound_high: 0.75 })).toBe("under");
    expect(bandRangeOf({ bound_low: 0.8, bound_high: 0.85 })).toBe("between");
  });

  it("drops the bound a criteria no longer uses", () => {
    // A leftover bound would keep narrowing a band the administrator believes
    // they widened, and nothing on screen would show it.
    expect(boundsForRange("at_or_above", 0.75, 0.8)).toEqual({ bound_low: 0.75, bound_high: null });
    expect(boundsForRange("under", 0.75, 0.8)).toEqual({ bound_low: null, bound_high: 0.8 });
    expect(boundsForRange("any", 0.75, 0.8)).toEqual({ bound_low: null, bound_high: null });
    expect(boundsForRange("between", 0.75, 0.8)).toEqual({ bound_low: 0.75, bound_high: 0.8 });
  });

  it("round-trips a percentage through the editor without drift", () => {
    expect(boundToInput(0.85, "percent")).toBe("85");
    expect(inputToBound("85", "percent")).toBeCloseTo(0.85);
    expect(inputToBound("", "percent")).toBeNull();
    expect(inputToBound("not a number", "percent")).toBeNull();
    // A non-ratio unit is stored as typed.
    expect(boundToInput(12000, "miles")).toBe("12000");
    expect(inputToBound("12000", "miles")).toBe(12000);
  });

  it("uses the unit's singular noun in penalty phrasing", () => {
    expect(unitNoun("occurrences")).toBe("occurrence");
    expect(unitNoun("vehicle-days")).toBe("vehicle");
    expect(unitNoun("miles")).toBe("mile");
  });
});

describe("warning about a ladder that will not score as intended", () => {
  const seededOtp: { tier_label: AssessmentTierLabel; bound_low: number | null; bound_high: number | null; qualifier_code: string | null }[] = [
    { tier_label: "meets", bound_low: 0.85, bound_high: null, qualifier_code: null },
    { tier_label: "warning", bound_low: 0.8, bound_high: 0.85, qualifier_code: null },
    { tier_label: "tier1", bound_low: 0.75, bound_high: 0.8, qualifier_code: null },
    { tier_label: "tier2", bound_low: null, bound_high: 0.75, qualifier_code: null },
  ];

  it("passes the Attachment G ladder as seeded", () => {
    expect(ladderWarnings(seededOtp, "percent")).toEqual([]);
  });

  it("names a gap no value falls into", () => {
    const gapped = seededOtp.map((tier) => tier.tier_label === "warning" ? { ...tier, bound_low: 0.82 } : tier);
    expect(ladderWarnings(gapped, "percent")).toEqual(["Nothing scores between 80% and 82%."]);
  });

  it("names an overlap and says which band wins", () => {
    const overlapping = seededOtp.map((tier) => tier.tier_label === "warning" ? { ...tier, bound_low: 0.7 } : tier);
    expect(ladderWarnings(overlapping, "percent")[0]).toContain("matches two bands; the earlier one wins");
  });

  it("catches a second catch-all band that can never score", () => {
    const twoCatchAlls: { tier_label: AssessmentTierLabel; bound_low: number | null; bound_high: number | null; qualifier_code: string | null }[] = [
      { tier_label: "tier1", bound_low: null, bound_high: null, qualifier_code: null },
      { tier_label: "tier2", bound_low: null, bound_high: null, qualifier_code: null },
    ];
    expect(ladderWarnings(twoCatchAlls, "occurrences")).toContain("More than one band matches any value; only the first will ever score.");
  });

  it("leaves qualified bands out of the range check", () => {
    // A qualified band is chosen by its marker, not by covering a range, so it
    // neither creates a gap nor overlaps one.
    const withQualified: { tier_label: AssessmentTierLabel; bound_low: number | null; bound_high: number | null; qualifier_code: string | null }[] = [
      { tier_label: "tier1", bound_low: null, bound_high: null, qualifier_code: null },
      { tier_label: "tier2", bound_low: null, bound_high: null, qualifier_code: "LAST_TRIP_OF_DAY" },
    ];
    expect(ladderWarnings(withQualified, "occurrences")).toEqual([]);
  });
});


describe("capWindowSentence", () => {
  it("says nothing escalates when there is no window", () => {
    expect(capWindowSentence({})).toContain("No corrective action window");
    expect(capWindowSentence({ cap_window_mode: null })).toContain("charged as they happen");
  });

  it("spells out a rolling window's length and that it never resets", () => {
    const sentence = capWindowSentence({ cap_window_mode: "rolling_days", cap_window_days: 90, cap_window_threshold: 3 });
    expect(sentence).toContain("More than 3 occurrences in any 90 consecutive days");
    expect(sentence).toContain("never resets");
  });

  // The whole reason the mode is recorded: the two rules differ at a quarter
  // boundary, so the sentence has to say which boundary applies.
  it("names the dates a calendar quarter restarts on", () => {
    const sentence = capWindowSentence({ cap_window_mode: "calendar_quarter", cap_window_threshold: 3 });
    expect(sentence).toContain("within one calendar quarter");
    expect(sentence).toContain("1 January");
    expect(sentence).not.toContain("consecutive days");
  });

  it("reads as singular for a threshold of one", () => {
    expect(capWindowSentence({ cap_window_mode: "calendar_quarter", cap_window_threshold: 1 }))
      .toContain("More than 1 occurrence within");
  });

  it("asks for the missing half rather than stating a rule it cannot describe", () => {
    expect(capWindowSentence({ cap_window_mode: "rolling_days", cap_window_threshold: 3 }))
      .toContain("Set the number of days");
    expect(capWindowSentence({ cap_window_mode: "rolling_days", cap_window_days: 90 }))
      .toContain("Once the threshold is set");
  });
});

describe("defaultTargetDisplay", () => {
  it("shows a ratio target as the percentage a reader expects", () => {
    expect(defaultTargetDisplay(0.85, "percent")).toBe("85%");
  });

  it("keeps the unit on a target that is not a percentage", () => {
    expect(defaultTargetDisplay(12000, "miles")).toBe("12,000 miles");
  });

  it("has nothing to show when there is no target", () => {
    expect(defaultTargetDisplay(null, "percent")).toBe("");
    expect(defaultTargetDisplay(undefined, "percent")).toBe("");
    expect(defaultTargetDisplay(Number.NaN, "percent")).toBe("");
  });
});
