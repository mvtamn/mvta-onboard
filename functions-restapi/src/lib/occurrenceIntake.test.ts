import { test } from "node:test";
import assert from "node:assert";
import { OCCURRENCE_LINK_EXPLANATIONS, occurrenceStateFor } from "./assessment/occurrenceIntake";
import { validateMissedTripValidation } from "./validation";

test("a confirmed trip attributed to the contractor is charged to the month", () => {
  assert.deepStrictEqual(occurrenceStateFor("confirmed", "contractor_error"),
    { review_status: "confirmed", attribution: "contractor_error" });
});

test("an excusable or MVTA-directed trip is recorded without being charged", () => {
  // Attachment G's relief: the event happened and belongs in the record, but
  // no penalty attaches. Dismissed is how assess.ts excludes it from scoring
  // while assessmentInput still counts it in the raw totals.
  assert.deepStrictEqual(occurrenceStateFor("confirmed", "excusable"),
    { review_status: "dismissed", attribution: "excusable" });
  assert.deepStrictEqual(occurrenceStateFor("confirmed", "mvta_directed"),
    { review_status: "dismissed", attribution: "mvta_directed" });
});

test("an undetermined attribution leaves the occurrence in the assessment queue", () => {
  // This is exactly what the candidate poll produced on its own, so a reviewer
  // who does not want to decide yet loses nothing by saying so.
  assert.deepStrictEqual(occurrenceStateFor("confirmed", "undetermined"),
    { review_status: "candidate", attribution: "undetermined" });
});

test("a false positive dismisses the occurrence whatever attribution is passed", () => {
  // The poll may already have raised a candidate from an earlier confirmation.
  // Recording a false positive has to retract it, or a trip the agency has
  // decided never happened keeps sitting in the month's queue.
  assert.deepStrictEqual(occurrenceStateFor("false_positive", "contractor_error"),
    { review_status: "dismissed", attribution: "undetermined" });
});

test("every non-linking reason has an explanation naming what to fix", () => {
  for (const [reason, explanation] of Object.entries(OCCURRENCE_LINK_EXPLANATIONS)) {
    assert.ok(explanation.length > 20, `${reason} needs a usable explanation`);
    assert.ok(/review was saved/i.test(explanation), `${reason} must say the review still committed`);
  }
});

const review = { trip_id: "t1", service_date: "20260825", validation_status: "confirmed", reason_code: "OPERATOR" };

test("attribution is optional, so callers predating it still validate", () => {
  assert.deepStrictEqual(validateMissedTripValidation(review), []);
});

test("attribution is checked against the values the occurrence table accepts", () => {
  assert.deepStrictEqual(validateMissedTripValidation({ ...review, attribution: "contractor_error" }), []);
  assert.ok(validateMissedTripValidation({ ...review, attribution: "contractor_fault" }).length);
});

test("a false positive cannot carry an attribution", () => {
  // There is no occurrence to attribute, and accepting one would let the UI
  // send a contradiction the server then has to reconcile silently.
  const errors = validateMissedTripValidation({ ...review, validation_status: "false_positive", attribution: "contractor_error" });
  assert.ok(errors.some((error) => error.includes("no occurrence to attribute")));
  assert.deepStrictEqual(validateMissedTripValidation({ ...review, validation_status: "false_positive" }), []);
});
