import assert from "node:assert/strict";
import test from "node:test";
import { availabilityFrom, replacementFrom, type ProcedureAvailability } from "./procedureAvailability";

const WHEN = new Date("2026-10-02T14:30:00.000Z");

function withdrawal(reason: string | null = "Bridge weight limit changed; the detour routes buses over it.") {
  return { event_type: "emergency_withdrawal", reason, occurred_at: WHEN };
}
function retirement(reason: string | null = "Replaced by the 2026 winter procedure.") {
  return { event_type: "retire", reason, occurred_at: WHEN };
}

test("a Procedure nobody authored is unknown, not unpublished", () => {
  // A mistyped or very old link must not be reported as "a Draft exists".
  assert.deepEqual(availabilityFrom({ condition: null, hasApproved: false, terminal: null, replacement: null }), { state: "unknown" } satisfies ProcedureAvailability);
});

test("an approved Procedure says only that it is approved", () => {
  // This is the quiet case: the reader filtered it out of view and nothing is
  // wrong, so the answer carries no condition for the UI to shout about.
  assert.deepEqual(availabilityFrom({ condition: "Bridge strike", hasApproved: true, terminal: retirement(), replacement: null }), { state: "approved" });
});

test("approved wins over a terminal event on an older revision", () => {
  // Retiring revision 3 and approving revision 4 leaves a retire event behind.
  // The Procedure is readable, so the event must not make it look stopped.
  const answer = availabilityFrom({ condition: "Bridge strike", hasApproved: true, terminal: retirement(), replacement: { procedure_id: "P-2", revision: 1, condition: "Other" } });
  assert.equal(answer.state, "approved");
});

test("authored but never approved is unpublished and names only the condition", () => {
  const answer = availabilityFrom({ condition: "Flooded underpass", hasApproved: false, terminal: null, replacement: null });
  assert.deepEqual(answer, { state: "unpublished", condition: "Flooded underpass" });
});

test("emergency withdrawal is distinguished from ordinary retirement", () => {
  // Both leave lifecycle_state 'Retired'; only the audit event says which.
  // The distinction is what the controller is told, so it must survive here.
  const w = availabilityFrom({ condition: "Bridge strike", hasApproved: false, terminal: withdrawal(), replacement: null });
  const r = availabilityFrom({ condition: "Bridge strike", hasApproved: false, terminal: retirement(), replacement: null });
  assert.equal(w.state, "withdrawn");
  assert.equal(r.state, "retired");
});

test("a withdrawal carries its reason and decision time", () => {
  const answer = availabilityFrom({ condition: "Bridge strike", hasApproved: false, terminal: withdrawal(), replacement: null });
  assert.deepEqual(answer, {
    state: "withdrawn",
    condition: "Bridge strike",
    decided_at: "2026-10-02T14:30:00.000Z",
    reason: "Bridge weight limit changed; the detour routes buses over it.",
    replacement: null,
  });
});

test("a withdrawal with no recorded reason still answers", () => {
  // reason is nullable in the audit table. A missing reason must not stop the
  // "must not be used" message, which is the part that matters.
  const answer = availabilityFrom({ condition: "Bridge strike", hasApproved: false, terminal: withdrawal(null), replacement: null });
  assert.equal(answer.state, "withdrawn");
  assert.equal(answer.reason, null);
});

test("a retirement offers its replacement", () => {
  const answer = availabilityFrom({ condition: "Snow route", hasApproved: false, terminal: retirement(), replacement: { procedure_id: "P-SNOW-2", revision: 2, condition: "Snow route (2026 revision)" } });
  assert.equal(answer.state, "retired");
  assert.deepEqual(answer.state === "retired" ? answer.replacement : null, { procedure_id: "P-SNOW-2", revision: 2, condition: "Snow route (2026 revision)" });
});

test("a replacement that is no longer approved is reported as none", () => {
  // Retirement checked the replacement was approved. It can have been retired
  // since, and offering it would dead-end the controller a second time, so the
  // caller re-checks and passes null.
  const answer = availabilityFrom({ condition: "Snow route", hasApproved: false, terminal: retirement(), replacement: null });
  assert.equal(answer.state, "retired");
  assert.equal(answer.state === "retired" ? answer.replacement : "unset", null);
});

test("a retire event's replacement is read from the audit detail", () => {
  assert.deepEqual(replacementFrom('{"replacement_procedure_id":"P-SNOW-2","replacement_revision":2}', "P-SNOW-1"), { procedure_id: "P-SNOW-2", revision: 2 });
});

test("a replacement revision alone means this same Procedure", () => {
  // `superseded` writes only a revision, and retirement defaults the id to the
  // Procedure being retired.
  assert.deepEqual(replacementFrom('{"replacement_revision":4}', "P-SNOW-1"), { procedure_id: "P-SNOW-1", revision: 4 });
});

test("a withdrawal's empty detail names no replacement", () => {
  assert.equal(replacementFrom("{}", "P-SNOW-1"), null);
});

test("unusable audit detail is no replacement rather than a throw", () => {
  // This runs while someone is trying to find out what to follow instead.
  // Number() turns null, "" and [] into 0, and 0 passed Number.isInteger, so
  // these used to yield a replacement pointing at "revision 0".
  for (const detail of ["not json", "[]", "null", '{"replacement_revision":"two"}', '{"replacement_revision":null}', '{"replacement_revision":1.5}', '{"replacement_revision":""}', '{"replacement_revision":[]}', '{"replacement_revision":false}', '{"replacement_revision":0}', '{"replacement_revision":-1}', '{"replacement_revision":"2"}']) {
    assert.equal(replacementFrom(detail, "P-SNOW-1"), null, detail);
  }
});

test("a blank replacement id falls back to this Procedure", () => {
  assert.deepEqual(replacementFrom('{"replacement_procedure_id":"   ","replacement_revision":3}', "P-SNOW-1"), { procedure_id: "P-SNOW-1", revision: 3 });
});
