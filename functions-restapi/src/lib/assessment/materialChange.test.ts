import assert from "node:assert/strict";
import test from "node:test";
import { MATERIAL_CHANGE_STATUSES, materialChangeSql } from "./materialChange";

// A Material Assessment Change is, by the glossary, a post-sharing change.
// Before sharing, a write simply lands; after it, the share is withdrawn, the
// Validation Window ends, and the month must be recomputed and re-shared.
test("a material change is only material after sharing", () => {
  assert.deepEqual([...MATERIAL_CHANGE_STATUSES], ["in_validation", "finalized"]);
});

test("the fragment withdraws the share, stales the period, and voids the live Issuance Proof", () => {
  const sql = materialChangeSql("period", "actor");
  assert.match(sql, /UPDATE ValidationDraftShares SET superseded_at=SYSUTCDATETIME\(\) WHERE period_id=@period AND superseded_at IS NULL/);
  assert.match(sql, /status=CASE WHEN status IN\('in_review','in_validation','finalized'\) THEN 'stale' ELSE status END/);
  assert.match(sql, /validation_shared_at=NULL/);
  assert.match(sql, /status<>'issued'/);
  // ADR 0029: the proof rendered from the pre-change state is not the one to check.
  assert.match(sql, /'issuance_proof_voided'/);
  assert.match(sql, /@actor/);
});
