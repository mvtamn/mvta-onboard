import assert from "node:assert/strict";
import test from "node:test";
import { decideAmount, decideChange, decideManual, decideNew, REFUSAL_SENTENCES } from "./decide";
import { occurrenceAssignmentSql } from "./assignment";

test("a new occurrence is written only when intake accepts it", () => {
  assert.equal(decideNew("accepted"), null);
  for (const state of ["unassigned", "standard_not_scored", "period_closed"] as const) {
    assert.deepEqual(decideNew(state), { code: state, sentence: REFUSAL_SENTENCES[state] });
  }
});

test("a hand-entered occurrence may name its contractor only if it is the Agreement's", () => {
  const assigned = "c0000000-0000-4000-8000-000000000001";
  assert.equal(decideManual({ state: "accepted", assignedContractorId: assigned }), null);
  assert.equal(decideManual({ state: "accepted", assignedContractorId: assigned, requestedContractorId: assigned.toUpperCase() }), null);
  assert.equal(decideManual({ state: "accepted", assignedContractorId: assigned, requestedContractorId: "c0000000-0000-4000-8000-000000000002" })?.code, "contractor_mismatch");
  // Assignment is decided before the contractor is compared.
  assert.equal(decideManual({ state: "unassigned", assignedContractorId: null, requestedContractorId: assigned })?.code, "unassigned");
  assert.equal(decideManual({ state: null, assignedContractorId: null })?.code, "standard_not_scored");
});

test("a change is refused only by its own month being finalized or issued", () => {
  assert.equal(decideChange(null)?.code, "not_found");
  for (const status of [null, "open", "in_review", "in_validation", "stale", "reopened"]) assert.equal(decideChange({ periodStatus: status }), null, String(status));
  for (const status of ["finalized", "issued"]) assert.equal(decideChange({ periodStatus: status })?.code, "period_closed");
});

test("a figure must sit inside the contract's band; clearing it needs no band", () => {
  const band = { periodStatus: "in_review", minAmount: 2500, maxAmount: 10000 };
  assert.equal(decideAmount(band, 2500), null);
  assert.equal(decideAmount(band, 10000), null);
  assert.match(decideAmount(band, 10001)?.sentence ?? "", /between 2500 and 10000/);
  assert.equal(decideAmount(band, null), null);
  assert.equal(decideAmount({ ...band, minAmount: null, maxAmount: null }, 99999), null);
  assert.equal(decideAmount({ ...band, periodStatus: "issued" }, null)?.code, "period_closed");
});

test("the assignment never breaks a tie by recency", () => {
  const fragment = occurrenceAssignmentSql("o.service_date", "o.standard_id", "x");
  assert.doesNotMatch(fragment, /TOP 1|ORDER BY|updated_at/i);
  assert.match(fragment, /agreements=1/);
  assert.throws(() => occurrenceAssignmentSql("d", "s", "x; DROP"), TypeError);
});
