import assert from "node:assert/strict";
import test from "node:test";
import {
  garageDepartureCandidatePredicate,
  garageDepartureVarianceSeconds,
} from "./complianceCandidatesPoll";

test("defaults to the ten-minute variance the integration spec named", () => {
  assert.equal(garageDepartureVarianceSeconds(undefined), 600);
});

test("takes a per-environment override", () => {
  assert.equal(garageDepartureVarianceSeconds("15"), 900);
  assert.equal(garageDepartureVarianceSeconds(" 2 "), 120);
});

test("treats a zero variance as deliberate, not as missing configuration", () => {
  // Zero means every late departure is reviewable. That is a defensible policy
  // choice, so it must not silently fall back to the default.
  assert.equal(garageDepartureVarianceSeconds("0"), 0);
});

test("falls back to the default rather than trusting unusable configuration", () => {
  // A malformed or negative setting must not become a threshold of NaN or a
  // negative one, either of which would make every row a candidate.
  for (const bad of ["", "ten", "-5", "abc10"]) {
    assert.equal(garageDepartureVarianceSeconds(bad), 600, `input: ${JSON.stringify(bad)}`);
  }
});

test("a run only qualifies when it never departed or departed beyond the variance", () => {
  const predicate = garageDepartureCandidatePredicate();
  assert.match(predicate, /pullout_actual IS NULL/, "a run that never departed is a candidate");
  assert.match(
    predicate,
    /DATEDIFF\(SECOND, d\.pullout_scheduled, d\.pullout_actual\) > @variance_seconds/,
    "a run that departed is only a candidate beyond the variance",
  );
  assert.match(predicate, /OR/, "the two cases are alternatives, not both required");
});

test("a run with no scheduled pullout is not a candidate", () => {
  // There is no committed time to have missed, so it is a gap in the source
  // rather than a breach - the same reason the missed-trip detector records
  // unknown_data_gap instead of escalating.
  assert.match(garageDepartureCandidatePredicate(), /pullout_scheduled IS NOT NULL/);
});

test("keeps Avail's own status as the maturity gate", () => {
  // The status is what says the pullout window has actually elapsed. Without it
  // a scheduled-but-not-yet-departed run would read as "never departed", and
  // the poll runs at 01:20 local - before the service day it would be judging.
  const predicate = garageDepartureCandidatePredicate();
  assert.match(predicate, /pullout_status IN \('Late Relief','Expired Pullout'\)/);
});
