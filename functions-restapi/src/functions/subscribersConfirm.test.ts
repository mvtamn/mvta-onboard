import assert from "node:assert/strict";
import test from "node:test";
import { smsAnswer } from "./subscribersConfirm";
import type { ConfirmOutcome } from "../lib/subscriberConfirmation";

// What this endpoint is allowed to tell a caller who supplies a phone number
// they may not own. The state machine distinguishes more than the HTTP surface
// does, on purpose, and the collapsing is the security boundary - so it is
// pinned here rather than left to a reader noticing the switch has two cases
// sharing a branch.

test("a wrong code and a number with nothing pending are one answer", () => {
  const wrong = smsAnswer("incorrect_code");
  const missing = smsAnswer("not_found");
  assert.deepEqual(
    wrong,
    missing,
    "distinguishing them would let anyone ask whether a given number is partway through signing up",
  );
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.status, "incorrect_code");
});

test("a rider who confirms twice is told it worked", () => {
  // Replying to the text again, or reloading the page, is not a mistake.
  assert.deepEqual(smsAnswer("already_confirmed"), smsAnswer("confirmed"));
  assert.equal(smsAnswer("confirmed").status, 200);
});

test("the actionable refusals keep their own names", () => {
  // The deliberate trade: each of these reveals that the number has an
  // unconfirmed confirmation, and each is the only thing the page can usefully
  // say to the rider who hit it.
  for (const outcome of ["expired", "superseded", "too_many_attempts", "opted_out"] as ConfirmOutcome[]) {
    const answer = smsAnswer(outcome);
    assert.equal(answer.status, 400);
    assert.equal(answer.body.status, outcome, `${outcome} must be reported as itself`);
  }
});

test("no outcome leaks a token or a subscriber id", () => {
  const outcomes: ConfirmOutcome[] = [
    "confirmed", "already_confirmed", "superseded", "expired",
    "too_many_attempts", "incorrect_code", "not_found", "opted_out",
  ];
  for (const outcome of outcomes) {
    assert.deepEqual(
      Object.keys(smsAnswer(outcome).body),
      ["status"],
      `${outcome} must answer with a status and nothing else`,
    );
  }
});
