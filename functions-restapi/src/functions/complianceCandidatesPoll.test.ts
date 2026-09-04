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

test("matches the statuses that say a departure was missed", () => {
  // Missed Pullout and Missed Login are 408 runs that provably never left the
  // garage, and neither matched the previous list.
  const predicate = garageDepartureCandidatePredicate();
  for (const status of ["Missed Pullout", "Missed Login", "Expired Pullout", "Late Pullout"]) {
    assert.match(predicate, new RegExp(`'${status}'`), `${status} must be a departure outcome`);
  }
});

test("does not match a status the feed has never emitted", () => {
  // 'Late Relief' headed the list and appears in no row of 22 days of data. It
  // came from the one sample payload the fixtures were built from.
  assert.doesNotMatch(garageDepartureCandidatePredicate(), /Late Relief/);
});

test("never treats a pull-in outcome as a departure", () => {
  // Nearly 1,900 rows describe a run's RETURN to the garage, which means its
  // departure already happened. Matching one would score a completed run.
  const predicate = garageDepartureCandidatePredicate();
  assert.doesNotMatch(predicate, /Pullin/);
});

test("leaves an unclassified run alone", () => {
  // A blank status is a run Avail is still resolving - every blank row seen was
  // from the current service day. The status list is the maturity gate: without
  // it, a run whose pullout has not been judged yet would read as "never
  // departed", and this poll runs at 01:20 local.
  const predicate = garageDepartureCandidatePredicate();
  assert.match(predicate, /pullout_status IN \(/, "an explicit list is what excludes unjudged runs");
  assert.doesNotMatch(predicate, /''/, "a blank status must not be listed");
});

test("leaves On Route No Pullout for investigation rather than penalty", () => {
  // Twelve of its thirteen rows have no departure, but the name says the
  // vehicle IS running - a missing pullout record, not a missing departure.
  assert.doesNotMatch(garageDepartureCandidatePredicate(), /On Route No Pullout/);
});
