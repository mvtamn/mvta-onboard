import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyConfirmation,
  MAX_CONFIRM_ATTEMPTS,
  type ConfirmationRow,
} from "./subscriberConfirmation";

const NOW = new Date("2026-09-11T12:00:00Z");
const LATER = new Date("2026-09-12T12:00:00Z");
const EARLIER = new Date("2026-09-11T11:00:00Z");

function row(overrides: Partial<ConfirmationRow> = {}): ConfirmationRow {
  return {
    confirmation_id: "11111111-1111-1111-1111-111111111111",
    subscriber_id: "22222222-2222-2222-2222-222222222222",
    channel: "sms",
    token: "123456",
    expires_at: LATER,
    confirmed_at: null,
    superseded_at: null,
    attempts: 0,
    subscriber_status: "pending_confirmation",
    ...overrides,
  };
}

test("a live, unexpired confirmation is eligible - not yet confirmed", () => {
  // "eligible" rather than "confirmed" is the point: for SMS the code still
  // has to match, and a classifier that said "confirmed" here would make the
  // caller's own check look optional.
  assert.equal(classifyConfirmation(row(), NOW), "eligible");
});

test("no row is not_found", () => {
  assert.equal(classifyConfirmation(null, NOW), "not_found");
});

test("a spent token is already_confirmed, not an error", () => {
  // A rider who clicks the email link twice, or whose mail client prefetched
  // it, has done nothing wrong and must not be shown a failure.
  assert.equal(classifyConfirmation(row({ confirmed_at: EARLIER }), NOW), "already_confirmed");
});

test("expiry at the boundary has passed", () => {
  assert.equal(classifyConfirmation(row({ expires_at: NOW }), NOW), "expired");
  assert.equal(classifyConfirmation(row({ expires_at: new Date(NOW.getTime() + 1) }), NOW), "eligible");
});

test("a superseded token points at the newer one", () => {
  assert.equal(classifyConfirmation(row({ superseded_at: EARLIER }), NOW), "superseded");
});

test("the attempt cap is reached at the cap, not past it", () => {
  assert.equal(classifyConfirmation(row({ attempts: MAX_CONFIRM_ATTEMPTS - 1 }), NOW), "eligible");
  assert.equal(classifyConfirmation(row({ attempts: MAX_CONFIRM_ATTEMPTS }), NOW), "too_many_attempts");
});

test("an opted-out subscriber cannot be revived by any token", () => {
  assert.equal(classifyConfirmation(row({ subscriber_status: "opted_out" }), NOW), "opted_out");
  // Including one that is otherwise perfect.
  assert.equal(
    classifyConfirmation(row({ subscriber_status: "opted_out", attempts: 0, expires_at: LATER }), NOW),
    "opted_out",
  );
});

// A row can be several things at once. The order these are checked in is the
// behaviour, so each pairing is pinned rather than left to the reading order of
// the function.
test("already_confirmed outranks every other state", () => {
  const spentAndRuined = row({
    confirmed_at: EARLIER,
    superseded_at: EARLIER,
    expires_at: EARLIER,
    attempts: MAX_CONFIRM_ATTEMPTS,
    subscriber_status: "opted_out",
  });
  assert.equal(
    classifyConfirmation(spentAndRuined, NOW),
    "already_confirmed",
    "a rider whose confirmation already worked is told it worked, whatever has happened to the row since",
  );
});

test("opted_out outranks superseded, expired and the attempt cap", () => {
  assert.equal(
    classifyConfirmation(
      row({ subscriber_status: "opted_out", superseded_at: EARLIER, expires_at: EARLIER, attempts: MAX_CONFIRM_ATTEMPTS }),
      NOW,
    ),
    "opted_out",
  );
});

test("superseded outranks expired", () => {
  // Both send the rider to a newer code, but only one is true, and "expired"
  // is confusing to someone holding the text that replaced it.
  assert.equal(classifyConfirmation(row({ superseded_at: EARLIER, expires_at: EARLIER }), NOW), "superseded");
});

test("an expired confirmation that is also locked out reads as expired", () => {
  // The remedy is the same resend either way, and the weaker statement tells a
  // guesser less about why they were refused.
  assert.equal(
    classifyConfirmation(row({ expires_at: EARLIER, attempts: MAX_CONFIRM_ATTEMPTS }), NOW),
    "expired",
  );
});
