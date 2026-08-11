import test from "node:test";
import assert from "node:assert/strict";
import { assignmentTarget } from "./eventAssignments.js";

test("draft and review assignments target the proposed plan", () => {
  assert.equal(assignmentTarget("draft"), "plan");
  assert.equal(assignmentTarget("review"), "plan");
});

test("active assignments target a reviewed revision", () => {
  assert.equal(assignmentTarget("active"), "revision");
});

test("approved, suspended, and completed plans cannot receive assignments", () => {
  assert.equal(assignmentTarget("approved"), "invalid");
  assert.equal(assignmentTarget("suspended"), "invalid");
  assert.equal(assignmentTarget("completed"), "invalid");
});
