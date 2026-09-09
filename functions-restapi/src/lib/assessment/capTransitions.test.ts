import assert from "node:assert/strict";
import test from "node:test";
import { CAP_SUBMISSION_FIELDS, capTransition, isCapOverdue } from "./capTransitions";

// A CAP Determination is made at issuance; from there the plan moves
// required -> submitted -> approved -> in_progress -> closed | failed, each
// step by the role Attachment G gives it. The six submission elements are
// what makes a submission complete, and closure needs a recorded note.
test("the six submission elements are the design's six", () => {
  assert.deepEqual([...CAP_SUBMISSION_FIELDS], ["root_cause", "corrective_actions", "responsible_parties", "timeline_note", "monitoring_plan", "closure_criteria"]);
});

test("a submission needs every element and is a writer's act", () => {
  assert.deepEqual(capTransition("required", "submitted", "writer", { root_cause: "x", corrective_actions: "y", responsible_parties: "z", timeline_note: "t", monitoring_plan: "m", closure_criteria: "c" }), { ok: true, sets: ["root_cause", "corrective_actions", "responsible_parties", "timeline_note", "monitoring_plan", "closure_criteria"], stamps: "submitted_at" });
  const partial = capTransition("required", "submitted", "writer", { root_cause: "x" });
  assert.equal(partial.ok, false);
  assert.match(String(!partial.ok && partial.error), /corrective_actions/);
});

test("approval, progress, closure, and failure are the manager's, and closure needs a note", () => {
  assert.equal(capTransition("submitted", "approved", "writer", {}).ok, false);
  assert.deepEqual(capTransition("submitted", "approved", "manager", {}), { ok: true, sets: [], stamps: null });
  assert.deepEqual(capTransition("approved", "in_progress", "manager", {}), { ok: true, sets: [], stamps: null });
  assert.equal(capTransition("in_progress", "closed", "manager", {}).ok, false);
  assert.deepEqual(capTransition("in_progress", "closed", "manager", { closure_note: "Verified two clean months" }), { ok: true, sets: ["closure_note"], stamps: "closed_at" });
  assert.deepEqual(capTransition("in_progress", "failed", "manager", { closure_note: "No plan followed" }), { ok: true, sets: ["closure_note"], stamps: "closed_at" });
});

test("a submission the manager sends back returns to required, and nothing skips a step", () => {
  assert.deepEqual(capTransition("submitted", "required", "manager", {}), { ok: true, sets: [], stamps: null });
  assert.equal(capTransition("required", "approved", "manager", {}).ok, false);
  assert.equal(capTransition("closed", "in_progress", "manager", {}).ok, false);
  assert.equal(capTransition("approved", "closed", "manager", { closure_note: "n" }).ok, false);
});

test("a CAP is overdue only while it is still required past its due date", () => {
  const due = new Date("2026-08-17T00:00:00Z");
  assert.equal(isCapOverdue("required", due, new Date("2026-08-18T00:00:00Z")), true);
  assert.equal(isCapOverdue("required", due, new Date("2026-08-16T00:00:00Z")), false);
  assert.equal(isCapOverdue("submitted", due, new Date("2026-08-18T00:00:00Z")), false);
});
