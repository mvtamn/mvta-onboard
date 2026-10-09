import assert from "node:assert/strict";
import test from "node:test";
import { WITHDRAWAL_REASON_MAX, withdrawalReason } from "./otpDateExclusionWithdrawal";

test("a withdrawal reason is required, because it moves a published figure", () => {
  // Since migration 140 an approved date subtracts departures from the
  // official monthly figure. Undoing that silently is what a reviewer would
  // later be unable to explain to the agency.
  for (const missing of [undefined, null, 42, {}, [], true]) {
    const checked = withdrawalReason(missing);
    assert.equal(checked.ok, false, String(missing));
    assert.match(checked.ok ? "" : checked.error, /needs a reason/i);
  }
});

test("a reason of nothing but whitespace is not a reason", () => {
  for (const blank of ["", " ", "\t\n  "]) {
    assert.equal(withdrawalReason(blank).ok, false, JSON.stringify(blank));
  }
});

test("a reason is trimmed, so it is stored as it reads", () => {
  const checked = withdrawalReason("  Approved against the wrong route scope.  ");
  assert.deepEqual(checked, { ok: true, reason: "Approved against the wrong route scope." });
});

test("a reason longer than the column is refused rather than silently cut", () => {
  // withdrawal_reason is NVARCHAR(500) in migration 142. Truncating would
  // store a sentence that stops mid-explanation and looks deliberate.
  assert.equal(withdrawalReason("x".repeat(WITHDRAWAL_REASON_MAX)).ok, true);
  const tooLong = withdrawalReason("x".repeat(WITHDRAWAL_REASON_MAX + 1));
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.ok ? "" : tooLong.error, /500 characters or fewer/);
});

test("length is measured after trimming, not before", () => {
  // Otherwise trailing spaces could refuse a reason that fits the column.
  assert.equal(withdrawalReason(`  ${"x".repeat(WITHDRAWAL_REASON_MAX)}  `).ok, true);
});
