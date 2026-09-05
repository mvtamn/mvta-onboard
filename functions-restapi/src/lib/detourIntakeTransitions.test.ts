import { test } from "node:test";
import assert from "node:assert";
import { intakeReviewRefusal, intakeStatusAfterUpdate, isOpenIntakeStatus } from "./detourIntakeTransitions";

test("pending intake accepts every review outcome", () => {
  for (const outcome of ["needs_information", "rejected", "duplicate", "withdrawn"] as const) {
    assert.strictEqual(intakeReviewRefusal("pending_review", outcome), null);
  }
});

test("returned intake can be closed out but not returned twice", () => {
  assert.strictEqual(intakeReviewRefusal("needs_information", "rejected"), null);
  assert.strictEqual(intakeReviewRefusal("needs_information", "duplicate"), null);
  assert.strictEqual(intakeReviewRefusal("needs_information", "withdrawn"), null);
  assert.match(intakeReviewRefusal("needs_information", "needs_information") ?? "", /already returned/);
});

test("decided intake refuses every review outcome", () => {
  for (const current of ["accepted", "rejected", "duplicate", "withdrawn"] as const) {
    assert.match(intakeReviewRefusal(current, "rejected") ?? "", /cannot be reviewed again/);
  }
});

test("editing an open intake lands it back in pending review; decided intakes are frozen", () => {
  assert.strictEqual(intakeStatusAfterUpdate("pending_review"), "pending_review");
  assert.strictEqual(intakeStatusAfterUpdate("needs_information"), "pending_review");
  for (const current of ["accepted", "rejected", "duplicate", "withdrawn"] as const) {
    assert.strictEqual(intakeStatusAfterUpdate(current), null);
  }
  assert.strictEqual(isOpenIntakeStatus("accepted"), false);
});
