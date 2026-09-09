import { describe, expect, it } from "vitest";
import { metricText, targetText } from "./scorecardDisplay.js";

const percent = { unit_label: "percent", direction: "higher_is_better" as const, target_value: null, target_display: null };
const counts = { unit_label: "occurrences", direction: "lower_is_better" as const, target_value: null, target_display: null };
const meets85 = [{ tier_label: "meets" as const, bound_low: 0.85, bound_high: null }, { tier_label: "warning" as const, bound_low: 0.8, bound_high: 0.85 }];

describe("metricText", () => {
  it("passes a readable figure through and formats a raw one from the unit", () => {
    expect(metricText({ metric_display: "83.6%", standard_type: "threshold", occurrence_count: 0 }, percent)).toBe("83.6%");
    expect(metricText({ metric_display: "0.8362388553570882", standard_type: "threshold", occurrence_count: 0 }, percent)).toBe("83.6%");
    expect(metricText({ metric_display: "6820", standard_type: "threshold", occurrence_count: 0 }, { unit_label: "miles" })).toBe("6,820 miles");
  });
  it("reads an occurrence standard's count as occurrences, singular when one", () => {
    expect(metricText({ metric_display: "0", standard_type: "occurrence", occurrence_count: 0 }, counts)).toBe("0 occurrences");
    expect(metricText({ metric_display: "1", standard_type: "occurrence", occurrence_count: 1 }, counts)).toBe("1 occurrence");
  });
  it("keeps No data, and a raw number when the catalog has no unit for it", () => {
    expect(metricText({ metric_display: "No data", standard_type: "threshold", occurrence_count: 0 }, percent)).toBe("No data");
    expect(metricText({ metric_display: "", standard_type: "threshold", occurrence_count: 0 }, percent)).toBe("No data");
    expect(metricText({ metric_display: "0.5", standard_type: "threshold", occurrence_count: 0 }, undefined)).toBe("0.5");
  });
});

describe("targetText", () => {
  it("keeps a target already in words", () => {
    expect(targetText({ target_display: "85% or above", standard_type: "threshold" }, percent, [])).toBe("85% or above");
  });
  it("replaces the compute step's placeholder with the catalog's stated target", () => {
    expect(targetText({ target_display: "Configured bands", standard_type: "threshold" }, { ...percent, target_display: "85% or above" }, [])).toBe("85% or above");
    expect(targetText({ target_display: "Configured bands", standard_type: "threshold" }, { ...percent, target_value: 0.93 }, [])).toBe("93% or above");
    expect(targetText({ target_display: "11", standard_type: "threshold" }, { ...counts, target_value: 11 }, [])).toBe("11 occurrences or fewer");
    expect(targetText({ target_display: "Configured bands", standard_type: "occurrence" }, { ...counts, target_value: 0 }, [])).toBe("0 occurrences");
  });
  it("falls back to the Meets band's range, then says there is no target", () => {
    expect(targetText({ target_display: "Configured bands", standard_type: "threshold" }, percent, meets85)).toBe("85% or above");
    expect(targetText({ target_display: "Configured bands", standard_type: "threshold" }, counts, [{ tier_label: "meets", bound_low: null, bound_high: 11 }])).toBe("Under 11 occurrences");
    expect(targetText({ target_display: "", standard_type: "threshold" }, percent, [])).toBe("No target set");
    expect(targetText({ target_display: "Configured bands", standard_type: "threshold" }, undefined, [])).toBe("No target set");
  });
  it("infers none as the target of an occurrence standard, and reads a capped Meets band as that many or fewer", () => {
    expect(targetText({ target_display: "Configured bands", standard_type: "occurrence" }, counts, [])).toBe("0 occurrences");
    expect(targetText({ target_display: "Configured bands", standard_type: "occurrence" }, counts, [{ tier_label: "meets", bound_low: null, bound_high: null }])).toBe("0 occurrences");
    expect(targetText({ target_display: "Configured bands", standard_type: "occurrence" }, counts, [{ tier_label: "meets", bound_low: null, bound_high: 1 }])).toBe("0 occurrences");
    expect(targetText({ target_display: "Configured bands", standard_type: "occurrence" }, counts, [{ tier_label: "meets", bound_low: 0, bound_high: 11 }])).toBe("10 occurrences or fewer");
    expect(targetText({ target_display: "Configured bands", standard_type: "occurrence" }, undefined, [])).toBe("0 occurrences");
    expect(targetText({ target_display: "Configured bands", standard_type: "occurrence" }, { ...counts, direction: "higher_is_better" }, [])).toBe("No target set");
  });
});
