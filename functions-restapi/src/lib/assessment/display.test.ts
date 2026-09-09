import assert from "node:assert/strict";
import test from "node:test";
import { formatQuantity, metricDisplay, targetDisplay, type DisplayStandard } from "./display";

const threshold = (over: Partial<DisplayStandard> = {}): DisplayStandard => ({
  standard_type: "threshold", direction: "higher_is_better", unit_label: "percent", target_value: null, target_display: null, ...over,
});
const occurrence = (over: Partial<DisplayStandard> = {}): DisplayStandard => ({
  standard_type: "occurrence", direction: "lower_is_better", unit_label: "occurrences", target_value: null, target_display: null, ...over,
});

test("a ratio reads as a percentage, a count as its noun, a measure with its unit", () => {
  assert.equal(formatQuantity(0.8362388553570882, "percent"), "83.6%");
  assert.equal(formatQuantity(7, "occurrences"), "7 occurrences");
  assert.equal(formatQuantity(1, "occurrences"), "1 occurrence");
  assert.equal(formatQuantity(6820, "miles"), "6,820 miles");
  assert.equal(formatQuantity(3, "vehicle-days"), "3 vehicle-days");
  assert.equal(formatQuantity(2.5, null), "2.5");
});

test("the month's figure: the count for an occurrence standard, the measured value for a threshold, No data when nothing measured it", () => {
  assert.equal(metricDisplay(null, occurrence(), 7), "7 occurrences");
  assert.equal(metricDisplay(0.836, threshold(), 0), "83.6%");
  assert.equal(metricDisplay(null, threshold(), 0), "No data");
});

test("the target prefers the contract's own words, then the stated value with its direction", () => {
  assert.equal(targetDisplay(threshold({ target_display: "85% or above", target_value: 0.85 }), []), "85% or above");
  assert.equal(targetDisplay(threshold({ target_value: 0.93 }), []), "93% or above");
  assert.equal(targetDisplay(threshold({ direction: "lower_is_better", unit_label: "occurrences", target_value: 11 }), []), "11 occurrences or fewer");
  assert.equal(targetDisplay(occurrence({ target_value: 0 }), []), "0 occurrences");
});

test("an occurrence standard with nothing stated is targeted at none, and a Meets band capped at a count reads as that many or fewer", () => {
  assert.equal(targetDisplay(occurrence(), []), "0 occurrences");
  assert.equal(targetDisplay(occurrence(), [{ tier_label: "meets", bound_low: null, bound_high: null }]), "0 occurrences");
  assert.equal(targetDisplay(occurrence(), [{ tier_label: "meets", bound_low: null, bound_high: 1 }]), "0 occurrences");
  assert.equal(targetDisplay(occurrence(), [{ tier_label: "meets", bound_low: null, bound_high: 11 }]), "10 occurrences or fewer");
  assert.equal(targetDisplay(occurrence({ unit_label: "vehicle-days" }), [{ tier_label: "meets", bound_low: 0, bound_high: 5 }]), "4 vehicle-days or fewer");
  assert.equal(targetDisplay(occurrence({ direction: "higher_is_better" }), []), "No target set");
});

test("without a stated target the Meets band's range stands in; without that, it says so", () => {
  const tiers = [{ tier_label: "meets", bound_low: 0.85, bound_high: null }, { tier_label: "warning", bound_low: 0.8, bound_high: 0.85 }];
  assert.equal(targetDisplay(threshold(), tiers), "85% or above");
  assert.equal(targetDisplay(threshold({ unit_label: "occurrences" }), [{ tier_label: "meets", bound_low: 0, bound_high: 11 }]), "0 occurrences to under 11 occurrences");
  assert.equal(targetDisplay(threshold(), []), "No target set");
});
