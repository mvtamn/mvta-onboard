import { test } from "node:test";
import assert from "node:assert";
import { attributionAuthorityNeeded, decideAttribution, reviewHandOffState, reviewStatusFor, REVIEW_HANDOFF_EXPLANATIONS } from "./index";
import { validateMissedTripValidation } from "../validation";

// Plan step 0.8 (MVTA, 2026-11-06): a specialist reviews, managers decide
// attribution, the COO decides excusable.

test("a confirmed review raises a candidate that counts for nothing until a manager attributes it", () => {
  assert.deepStrictEqual(reviewHandOffState(true, null), { review_status: "candidate", attribution: "undetermined" });
  assert.deepStrictEqual(reviewHandOffState(true, { reviewStatus: "candidate", attribution: "undetermined" }),
    { review_status: "candidate", attribution: "undetermined" });
});

test("restating a confirmation leaves an attribution already decided where it stands", () => {
  // A reviewer superseding a review with a better reason does not undo the
  // manager's or the COO's decision.
  assert.deepStrictEqual(reviewHandOffState(true, { reviewStatus: "confirmed", attribution: "contractor_error" }),
    { review_status: "confirmed", attribution: "contractor_error" });
  assert.deepStrictEqual(reviewHandOffState(true, { reviewStatus: "dismissed", attribution: "excusable" }),
    { review_status: "dismissed", attribution: "excusable" });
});

test("a review that is not a confirmation dismisses the occurrence and clears its attribution", () => {
  // The poll or an earlier confirmation may have raised it. A trip the agency
  // has decided did not miss has nothing to attribute.
  assert.deepStrictEqual(reviewHandOffState(false, { reviewStatus: "confirmed", attribution: "contractor_error" }),
    { review_status: "dismissed", attribution: "undetermined" });
});

test("only contractor error is charged; excusable and MVTA-directed are recorded without a penalty", () => {
  assert.equal(reviewStatusFor("contractor_error"), "confirmed");
  assert.equal(reviewStatusFor("excusable"), "dismissed");
  assert.equal(reviewStatusFor("mvta_directed"), "dismissed");
  assert.equal(reviewStatusFor("undetermined"), "candidate");
});

test("excusable, either way, is the COO's; every other attribution is a manager's", () => {
  assert.equal(attributionAuthorityNeeded("undetermined", "contractor_error"), "attribute");
  assert.equal(attributionAuthorityNeeded("contractor_error", "mvta_directed"), "attribute");
  assert.equal(attributionAuthorityNeeded("mvta_directed", "undetermined"), "attribute");
  assert.equal(attributionAuthorityNeeded("undetermined", "excusable"), "excuse");
  assert.equal(attributionAuthorityNeeded("excusable", "contractor_error"), "excuse");
});

test("a manager cannot decide excusable, and the COO cannot charge the contractor", () => {
  const open = { periodStatus: "in_review", reviewStatus: "candidate" as const, attribution: "undetermined" as const };
  const manager = { attribute: true, excuse: false };
  const coo = { attribute: false, excuse: true };
  const reviewer = { attribute: false, excuse: false };
  assert.equal(decideAttribution(open, "contractor_error", manager), null);
  assert.equal(decideAttribution(open, "excusable", manager)?.code, "attribution_authority");
  assert.equal(decideAttribution(open, "excusable", coo), null);
  assert.equal(decideAttribution(open, "contractor_error", coo)?.code, "attribution_authority");
  assert.equal(decideAttribution(open, "contractor_error", reviewer)?.code, "attribution_authority");
  // Undoing an excusable decision is the COO's too.
  const excused = { ...open, reviewStatus: "dismissed" as const, attribution: "excusable" as const };
  assert.equal(decideAttribution(excused, "contractor_error", manager)?.code, "attribution_authority");
  assert.equal(decideAttribution(excused, "contractor_error", coo), null);
});

test("an occurrence reviewed as not having happened, or in a closed month, cannot be attributed", () => {
  const all = { attribute: true, excuse: true };
  assert.equal(decideAttribution({ periodStatus: null, reviewStatus: "dismissed", attribution: "undetermined" }, "contractor_error", all)?.code, "not_attributable");
  assert.equal(decideAttribution({ periodStatus: "finalized", reviewStatus: "candidate", attribution: "undetermined" }, "contractor_error", all)?.code, "period_closed");
  assert.equal(decideAttribution(null, "contractor_error", all)?.code, "not_found");
});

test("every non-linking reason has an explanation naming what to fix", () => {
  for (const [reason, explanation] of Object.entries(REVIEW_HANDOFF_EXPLANATIONS)) {
    assert.ok(explanation.length > 20, `${reason} needs a usable explanation`);
    assert.ok(/review was saved/i.test(explanation), `${reason} must say the review still committed`);
  }
});

const review = { trip_id: "t1", service_date: "20260825", validation_status: "confirmed", reason_code: "OPERATOR" };

test("a review needs no attribution", () => {
  assert.deepStrictEqual(validateMissedTripValidation(review), []);
  // An older console sends `undetermined` for a non-confirmation; harmless.
  assert.deepStrictEqual(validateMissedTripValidation({ ...review, attribution: "undetermined" }), []);
});

test("a review cannot set attribution: that is a manager's separate decision", () => {
  for (const attribution of ["contractor_error", "excusable", "mvta_directed"]) {
    const errors = validateMissedTripValidation({ ...review, attribution });
    assert.ok(errors.some((error) => error.includes("recorded separately")), attribution);
  }
  assert.ok(validateMissedTripValidation({ ...review, attribution: "contractor_fault" }).length);
});
