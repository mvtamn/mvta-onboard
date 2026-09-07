import { test } from "node:test";
import assert from "node:assert";
import {
  validateAgreementStandardAssignments,
  validatePerformanceAgreement,
  validatePerformanceStandard,
  validateStandardTierLadder,
} from "./validation";

// A standard a manager could plausibly add through Administration >
// Performance Standards: an occurrence-based, manually logged one.
const standard = {
  code: "SHELTER_CLEANING", name: "Shelter cleaning compliance", standard_type: "occurrence",
  priority: "Medium", is_scored: true, is_safety_critical: false, direction: "lower_is_better",
  unit_label: "occurrences", measurement_source: "manual", sort_order: 27,
  effective_start_date: "20260101", effective_end_date: null,
};

test("a well-formed occurrence standard validates", () => {
  assert.deepStrictEqual(validatePerformanceStandard(standard), []);
});

test("a threshold standard validates the same way", () => {
  assert.deepStrictEqual(validatePerformanceStandard({
    ...standard, code: "FLEET_AVAILABILITY", standard_type: "threshold",
    direction: "higher_is_better", unit_label: "percent",
  }), []);
});

test("an automated standard must name the resolver that measures it", () => {
  // Without one the compute reports the standard not assessable and names the
  // misconfiguration, but refusing the save is far cheaper than finding it at
  // month-end close.
  const errors = validatePerformanceStandard({ ...standard, measurement_source: "auto" });
  assert.ok(errors.some((error) => error.includes("resolver_key is required")));
});

test("the resolver named has to be one the registry answers to", () => {
  // resolver_key was free text for as long as nothing read it. A typo now
  // fails here rather than silently producing a standard nothing measures.
  const errors = validatePerformanceStandard({ ...standard, measurement_source: "auto", resolver_key: "SHELTER_CLEANING" });
  assert.ok(errors.some((error) => error.includes("must name a registered resolver")));
  assert.deepStrictEqual(
    validatePerformanceStandard({ ...standard, measurement_source: "auto", resolver_key: "MISSED_TRIPS_FR" }),
    [],
  );
});

test("a resolver cannot be attached to the kind of standard it cannot serve", () => {
  // OTP_FIXED_ROUTE measures a monthly value; MISSED_TRIPS_FR raises
  // occurrences. Crossing them produces a standard whose compute can never
  // find a number, which is exactly the failure the registry exists to stop.
  const occurrenceWithMeasurer = validatePerformanceStandard({
    ...standard, standard_type: "occurrence", measurement_source: "auto", resolver_key: "OTP_FIXED_ROUTE",
  });
  assert.ok(occurrenceWithMeasurer.some((error) => error.includes("cannot feed an occurrence standard")));

  const thresholdWithIntake = validatePerformanceStandard({
    ...standard, standard_type: "threshold", direction: "higher_is_better", unit_label: "percent",
    measurement_source: "auto", resolver_key: "MISSED_TRIPS_FR",
  });
  assert.ok(thresholdWithIntake.some((error) => error.includes("cannot measure a threshold standard")));
});

test("a manual standard is unaffected by the registry", () => {
  assert.deepStrictEqual(validatePerformanceStandard({ ...standard, measurement_source: "manual" }), []);
});

test("a code that operational SQL could not match is rejected", () => {
  for (const code of ["lower_case", "9LEADING_DIGIT", "HAS SPACE", "AB"]) {
    assert.ok(validatePerformanceStandard({ ...standard, code }).length, `${code} should be rejected`);
  }
});

test("a retirement date cannot precede the effective date", () => {
  const errors = validatePerformanceStandard({ ...standard, effective_end_date: "20251231" });
  assert.ok(errors.some((error) => error.includes("must not precede effective_start_date")));
});

test("an enumeration outside the database CHECK constraint is rejected here first", () => {
  assert.ok(validatePerformanceStandard({ ...standard, standard_type: "rolling" }).length);
  assert.ok(validatePerformanceStandard({ ...standard, priority: "Critical" }).length);
  assert.ok(validatePerformanceStandard({ ...standard, direction: "either" }).length);
  assert.ok(validatePerformanceStandard({ ...standard, measurement_source: "imported" }).length);
});

// The OTP ladder as Attachment G v2 sets it, stored as ratios.
const otpLadder = {
  agreement_id: null, effective_start_date: "20260101",
  tiers: [
    { tier_label: "meets", bound_low: 0.85, bound_high: null, penalty_basis: "none", penalty_amount: 0, triggers_cap: false },
    { tier_label: "warning", bound_low: 0.8, bound_high: 0.85, penalty_basis: "none", penalty_amount: 0, triggers_cap: false },
    { tier_label: "tier1", bound_low: 0.75, bound_high: 0.8, penalty_basis: "flat", penalty_amount: 1500, triggers_cap: false },
    { tier_label: "tier2", bound_low: null, bound_high: 0.75, penalty_basis: "flat", penalty_amount: 3500, triggers_cap: false },
  ],
};

test("the Attachment G OTP ladder validates", () => {
  assert.deepStrictEqual(validateStandardTierLadder(otpLadder), []);
});

test("a band whose bounds are inverted is rejected", () => {
  const errors = validateStandardTierLadder({
    ...otpLadder,
    tiers: [{ tier_label: "tier1", bound_low: 0.9, bound_high: 0.8, penalty_basis: "flat", penalty_amount: 1500, triggers_cap: false }],
  });
  assert.ok(errors.some((error) => error.includes("bound_low must be below bound_high")));
});

test("a band cannot charge money on the none basis, or name a basis and charge nothing", () => {
  const charging = validateStandardTierLadder({
    ...otpLadder,
    tiers: [{ tier_label: "meets", bound_low: 0.85, bound_high: null, penalty_basis: "none", penalty_amount: 500, triggers_cap: false }],
  });
  assert.ok(charging.some((error) => error.includes("must be 0 when penalty_basis is none")));
  const free = validateStandardTierLadder({
    ...otpLadder,
    tiers: [{ tier_label: "tier1", bound_low: null, bound_high: 0.75, penalty_basis: "flat", penalty_amount: 0, triggers_cap: false }],
  });
  assert.ok(free.some((error) => error.includes("use penalty_basis none")));
});

test("a ladder version needs an effective date and at least one band", () => {
  assert.ok(validateStandardTierLadder({ agreement_id: null, tiers: otpLadder.tiers }).some((e) => e.includes("effective_start_date")));
  assert.ok(validateStandardTierLadder({ agreement_id: null, effective_start_date: "20260101", tiers: [] }).some((e) => e.includes("at least one tier")));
});

test("an agreement-scoped ladder takes a GUID or null, nothing else", () => {
  assert.deepStrictEqual(validateStandardTierLadder({ ...otpLadder, agreement_id: "3f1b2c8e-0d4a-4f5b-9c6d-7e8f90a1b2c3" }), []);
  assert.ok(validateStandardTierLadder({ ...otpLadder, agreement_id: "the-current-one" }).length);
});

const agreement = {
  contractor_id: "3f1b2c8e-0d4a-4f5b-9c6d-7e8f90a1b2c3", starts_on: "20250101", ends_on: "20291231",
  validation_business_days: 5, retention_years: 7, is_active: true,
};

test("a well-formed agreement validates", () => {
  assert.deepStrictEqual(validatePerformanceAgreement(agreement), []);
});

test("an agreement cannot end before it starts", () => {
  assert.ok(validatePerformanceAgreement({ ...agreement, ends_on: "20241231" }).some((e) => e.includes("must not precede starts_on")));
});

test("the validation window and retention period stay inside contract-plausible bounds", () => {
  assert.ok(validatePerformanceAgreement({ ...agreement, validation_business_days: 0 }).length);
  assert.ok(validatePerformanceAgreement({ ...agreement, validation_business_days: 45 }).length);
  assert.ok(validatePerformanceAgreement({ ...agreement, retention_years: 0 }).length);
});

test("standard assignments validate per row and name the row that failed", () => {
  assert.deepStrictEqual(validateAgreementStandardAssignments({
    assignments: [{ standard_id: "3f1b2c8e-0d4a-4f5b-9c6d-7e8f90a1b2c3", is_scored: true, effective_start_date: "20250101" }],
  }), []);
  const errors = validateAgreementStandardAssignments({
    assignments: [
      { standard_id: "3f1b2c8e-0d4a-4f5b-9c6d-7e8f90a1b2c3", is_scored: true, effective_start_date: "20250101" },
      { standard_id: "not-a-guid", is_scored: true, effective_start_date: "20250101" },
    ],
  });
  assert.ok(errors.some((error) => error.startsWith("assignments[1].standard_id")));
});

test("an empty assignment list is refused rather than silently doing nothing", () => {
  assert.ok(validateAgreementStandardAssignments({ assignments: [] }).length);
  assert.ok(validateAgreementStandardAssignments({ assignments: "all" }).length);
});
