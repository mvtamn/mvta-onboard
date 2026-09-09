import assert from "node:assert/strict";
import test from "node:test";
import { voidLiveIssuanceProofSql } from "./issuanceProof";

test("voiding names the live proof precisely and records why in the audit", () => {
  const fragment = voidLiveIssuanceProofSql("period", "actor");
  // Live proof: a 'final' row that is neither issued nor already voided.
  assert.match(fragment, /issuance_type='final' AND issued_at IS NULL AND voided_at IS NULL/);
  assert.match(fragment, /'issuance_proof_voided'/);
  // Nothing is deleted.
  assert.doesNotMatch(fragment, /DELETE/i);
  // Binds to the caller's parameters rather than inventing its own.
  assert.match(fragment, /@period/);
  assert.match(fragment, /@actor/);
});
