import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OTP_TARGET, frozenTarget, usableTarget, type TargetRow } from "./target";

// Which target a month is judged against. The branch that matters most here -
// several Assessment Periods covering one month, so none of them may answer -
// had no test at all while it lived inside measureOtpMonth: the db contract
// test covers one period and no period, never two.

test("one Assessment Period covering the month decides the target", () => {
  assert.equal(frozenTarget([{ target_value: 0.9, bound_low: null }]), 0.9);
});

test("a month with no Assessment Period falls through to the catalog", () => {
  assert.equal(frozenTarget([]), null);
});

test("several periods covering one month means none of them answers", () => {
  // Several periods are several contractors, and nothing here says which one
  // the figure belongs to. Putting one contractor's negotiated target on
  // another's figure is worse than falling back to the catalog, so this
  // returns null and the caller goes on.
  assert.equal(frozenTarget([
    { target_value: 0.9, bound_low: null },
    { target_value: 0.8, bound_low: null },
  ]), null);
});

test("an explicit target wins over the band it sits in", () => {
  assert.equal(usableTarget({ target_value: 0.92, bound_low: 0.85 }), 0.92);
});

test("the band's lower bound answers where no explicit target was set", () => {
  // Standards predating the target_value column carry only tiers.
  assert.equal(usableTarget({ target_value: null, bound_low: 0.85 }), 0.85);
});

test("a row with neither is not a target", () => {
  assert.equal(usableTarget({ target_value: null, bound_low: null }), null);
  assert.equal(usableTarget(undefined), null);
});

test("a stored value that is not a finite number is refused rather than used", () => {
  // A NaN reaching below_target would make every route read as meeting.
  assert.equal(usableTarget({ target_value: Number.NaN, bound_low: null }), null);
  assert.equal(usableTarget({ target_value: Number.POSITIVE_INFINITY, bound_low: null }), null);
  assert.equal(frozenTarget([{ target_value: Number.NaN, bound_low: null }]), null);
});

test("a numeric string from the driver is a target, not a string", () => {
  assert.equal(usableTarget({ target_value: "0.9" as unknown as number, bound_low: null }), 0.9);
});

test("Attachment G's figure is what answers when nothing else does", () => {
  assert.equal(DEFAULT_OTP_TARGET, 0.85);
});
