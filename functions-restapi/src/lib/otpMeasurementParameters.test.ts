import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OTP_MEASUREMENT_PARAMETERS,
  monthsNeedingRepull,
  parameterSegments,
  parametersOrDefault,
  validateParameterSet,
  type MonthProvenanceRow,
  type OtpMeasurementParameterSet,
} from "./otpMeasurementParameters";

// What can be proved without a database: the string that goes in the URL and in
// the stamp, what happens when the register cannot answer, which sets are
// standards at all, and which months are no longer comparable with today's.
// The register's own round trip and the persisted computed column are in
// measurementParameters.db.contract.test.ts.

const DECLARED = "2/5/10/60/0/1/1";
const SPEC_EXAMPLE = "1/5/15/30/0/1/1";

test("the segments are MVTA's confirmed standard, in Avail's order", () => {
  assert.equal(parameterSegments(DEFAULT_OTP_MEASUREMENT_PARAMETERS), DECLARED);
});

test("the order is the contract, not the field names", () => {
  // Built back-to-front on purpose: a set assembled in any order still sends
  // early / late / early outlier / late outlier / missed / outliers / detours.
  const set: OtpMeasurementParameterSet = {
    show_detours: 0,
    include_outliers: 0,
    show_missed_stops: 1,
    late_outlier_minutes: 45,
    early_outlier_minutes: 12,
    late_threshold_minutes: 6,
    early_threshold_minutes: 3,
  };
  assert.equal(parameterSegments(set), "3/6/12/45/1/0/0");
});

test("no row at all yields the compiled default, reported as the compiled default", () => {
  for (const row of [undefined, null]) {
    const answer = parametersOrDefault(row);
    assert.deepEqual(answer.set, DEFAULT_OTP_MEASUREMENT_PARAMETERS);
    // The whole reason this is reported: a fallback must not read as a
    // declaration anybody made.
    assert.equal(answer.origin, "code");
  }
});

test("a complete declared row is used as declared", () => {
  const row = {
    early_threshold_minutes: 1,
    late_threshold_minutes: 5,
    early_outlier_minutes: 15,
    late_outlier_minutes: 30,
    show_missed_stops: 0 as const,
    include_outliers: 1 as const,
    show_detours: 1 as const,
  };
  const answer = parametersOrDefault(row);
  assert.equal(answer.origin, "register");
  assert.equal(parameterSegments(answer.set), SPEC_EXAMPLE);
});

test("a row failing any rule is discarded whole, never patched field by field", () => {
  // A set with one substituted number is a standard nobody declared, and the
  // figures it produced could not be explained by either set.
  const answer = parametersOrDefault({
    ...DEFAULT_OTP_MEASUREMENT_PARAMETERS,
    early_outlier_minutes: 1, // below the early threshold: the band is empty
  });
  assert.deepEqual(answer.set, DEFAULT_OTP_MEASUREMENT_PARAMETERS);
  assert.equal(answer.origin, "code");
});

test("a set is valid only if every number is a whole positive number of minutes", () => {
  assert.deepEqual(validateParameterSet({ ...DEFAULT_OTP_MEASUREMENT_PARAMETERS }), []);
  for (const bad of [0, -2, 2.5, "2", null, undefined, Number.NaN]) {
    const errors = validateParameterSet({ ...DEFAULT_OTP_MEASUREMENT_PARAMETERS, early_threshold_minutes: bad });
    assert.equal(errors.length, 1, `${String(bad)} should be refused`);
    assert.match(errors[0]!, /early_threshold_minutes/);
  }
});

test("an outlier bound at or below its own threshold is refused", () => {
  // Not taste: it makes the band it bounds empty, so the set measures nothing.
  assert.match(
    validateParameterSet({ ...DEFAULT_OTP_MEASUREMENT_PARAMETERS, early_outlier_minutes: 2 }).join(";"),
    /early_outlier_minutes must be greater than early_threshold_minutes/,
  );
  assert.match(
    validateParameterSet({ ...DEFAULT_OTP_MEASUREMENT_PARAMETERS, late_outlier_minutes: 5 }).join(";"),
    /late_outlier_minutes must be greater than late_threshold_minutes/,
  );
});

test("a threshold over an hour is a typo, not a standard", () => {
  assert.match(
    validateParameterSet({ ...DEFAULT_OTP_MEASUREMENT_PARAMETERS, late_threshold_minutes: 90, late_outlier_minutes: 120 }).join(";"),
    /late_threshold_minutes must be 60 or less/,
  );
});

test("the flags must be 0 or 1, not merely truthy", () => {
  for (const key of ["show_missed_stops", "include_outliers", "show_detours"]) {
    const errors = validateParameterSet({ ...DEFAULT_OTP_MEASUREMENT_PARAMETERS, [key]: true });
    assert.deepEqual(errors, [`${key} is required and must be 0 or 1`]);
  }
});

const month = (service_month: string, segments: string | null, rows: number): MonthProvenanceRow => ({
  service_month,
  segments,
  rows,
  first_stored_at: "2026-10-01T00:00:00.000Z",
  last_stored_at: "2026-10-27T00:00:00.000Z",
});

test("a month entirely polled under the standard in force needs nothing", () => {
  assert.deepEqual(monthsNeedingRepull([month("202610", DECLARED, 2700)], DECLARED), []);
});

test("a month polled under the previous standard needs re-pulling, with what it holds", () => {
  const needed = monthsNeedingRepull([month("202605", SPEC_EXAMPLE, 2612)], DECLARED);
  assert.equal(needed.length, 1);
  assert.equal(needed[0]!.service_month, "202605");
  assert.equal(needed[0]!.rows_in_force, 0);
  assert.deepEqual(needed[0]!.stale.map((row) => [row.segments, row.rows]), [[SPEC_EXAMPLE, 2612]]);
});

test("rows stored before stamping existed read as unrecorded, not as current", () => {
  // The reason migration 151 leaves them NULL: the stamp is a property of a
  // poll, and claiming the current set for them would invent provenance.
  const needed = monthsNeedingRepull([month("202601", null, 1800)], DECLARED);
  assert.equal(needed.length, 1);
  assert.equal(needed[0]!.rows_unrecorded, 1800);
});

test("a month polled across a declaration reports both halves", () => {
  // Which is itself the finding: part of the month is comparable with today and
  // part is not, and a single verdict would hide that.
  const needed = monthsNeedingRepull(
    [month("202610", DECLARED, 2000), month("202610", SPEC_EXAMPLE, 700), month("202610", null, 12)],
    DECLARED,
  );
  assert.equal(needed.length, 1);
  assert.equal(needed[0]!.rows_in_force, 2000);
  assert.equal(needed[0]!.rows_unrecorded, 12);
  // Biggest stale set first - that is the one that explains a moved figure.
  assert.deepEqual(needed[0]!.stale.map((row) => row.rows), [700, 12]);
});

test("months come back newest first, which is the order a reviewer works in", () => {
  const needed = monthsNeedingRepull(
    [month("202605", SPEC_EXAMPLE, 1), month("202608", SPEC_EXAMPLE, 1), month("202606", SPEC_EXAMPLE, 1)],
    DECLARED,
  );
  assert.deepEqual(needed.map((m) => m.service_month), ["202608", "202606", "202605"]);
});

test("the three Tier A months all need re-pulling before they can be compared", () => {
  // docs/handoffs/otp-compliance-validation-plan-2026-09-22.md puts 2026-05,
  // 2026-06 and 2026-08 against the manual figure. All three are outside the
  // poller's trailing window, so all three still hold spec-example figures, and
  // comparing them as they stand would measure two different standards and call
  // the difference a defect in OnBoard.
  const needed = monthsNeedingRepull(
    ["202605", "202606", "202608"].map((m) => month(m, SPEC_EXAMPLE, 2600)),
    DECLARED,
  );
  assert.deepEqual(needed.map((m) => m.service_month), ["202608", "202606", "202605"]);
});
