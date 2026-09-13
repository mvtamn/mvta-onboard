import assert from "node:assert/strict";
import test from "node:test";
import { isE164, normalizeUsPhone } from "./phone";

// These cases are the same ones frontend/packages/shared/src/phone.test.ts
// pins, on purpose. The two normalizers are separate copies because the
// Function App does not build the frontend workspace, and the only thing
// keeping them from drifting is that both files assert the same answers.

test("a number typed the way a rider writes it becomes E.164", () => {
  for (const typed of ["6125550123", "612-555-0123", "(612) 555-0123", " 612 555 0123 ", "612.555.0123"]) {
    assert.equal(normalizeUsPhone(typed), "+16125550123", typed);
  }
});

test("a leading 1 is a country code, not an eleventh digit", () => {
  assert.equal(normalizeUsPhone("1 612 555 0123"), "+16125550123");
  assert.equal(normalizeUsPhone("1-612-555-0123"), "+16125550123");
});

test("an explicit + keeps the country the caller claimed", () => {
  assert.equal(normalizeUsPhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizeUsPhone("+1 (612) 555-0123"), "+16125550123");
});

test("digits that cannot be a number are null, not a guess", () => {
  // Nine digits and twelve are both nearly a US number, and "nearly" is what
  // produces a lookup against a number that cannot exist.
  for (const typed of ["", "   ", "612555012", "61255501231", "not a phone", "+", "+0123456789"]) {
    assert.equal(normalizeUsPhone(typed), null, typed);
  }
});

test("isE164 accepts what the API stores and nothing else", () => {
  assert.equal(isE164("+16125550123"), true);
  assert.equal(isE164("6125550123"), false);
  assert.equal(isE164("+0612555012"), false);
});
