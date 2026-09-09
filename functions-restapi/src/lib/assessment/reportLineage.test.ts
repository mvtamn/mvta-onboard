import assert from "node:assert/strict";
import test from "node:test";
import { resolveFinalRequest } from "./reportLineage";

// A correction period is one created by reopening an issued month; it carries
// the id of the period it corrects. Everything about supersession follows
// from that one fact, so the client is never asked to name a target.
const correction = { supersedesPeriodId: "period-v1", latestIssuedFinalOfSupersededPeriod: "final-v1" };
const original = { supersedesPeriodId: null, latestIssuedFinalOfSupersededPeriod: null };

test("a correction period derives its supersession target and needs a reason", () => {
  assert.deepEqual(resolveFinalRequest(correction, { supersede_reason: "Wrong recipient on the July issuance" }), {
    ok: true,
    supersedesId: "final-v1",
    supersedeReason: "Wrong recipient on the July issuance",
  });
});

test("a correction period without a reason is refused", () => {
  const result = resolveFinalRequest(correction, {});
  assert.equal(result.ok, false);
  assert.match(String(!result.ok && result.error), /reason/i);
});

test("the client's supersedes_id is ignored, not trusted", () => {
  const result = resolveFinalRequest(correction, { supersedes_id: "some-unissued-proof", supersede_reason: "Corrected tier" });
  assert.deepEqual(result, { ok: true, supersedesId: "final-v1", supersedeReason: "Corrected tier" });
});

test("a period that corrects nothing cannot carry a reason", () => {
  const result = resolveFinalRequest(original, { supersede_reason: "just because" });
  assert.equal(result.ok, false);
  assert.match(String(!result.ok && result.error), /corrects nothing/i);
});

test("a period that corrects nothing generates a plain Final with no lineage", () => {
  assert.deepEqual(resolveFinalRequest(original, {}), { ok: true, supersedesId: null, supersedeReason: null });
});

test("a correction period whose predecessor was never issued is a broken lineage, not a Final", () => {
  const result = resolveFinalRequest({ supersedesPeriodId: "period-v1", latestIssuedFinalOfSupersededPeriod: null }, { supersede_reason: "x" });
  assert.equal(result.ok, false);
  assert.match(String(!result.ok && result.error), /never issued/i);
});

test("a whitespace reason is no reason", () => {
  assert.equal(resolveFinalRequest(correction, { supersede_reason: "   " }).ok, false);
});
