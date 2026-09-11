import assert from "node:assert/strict";
import test from "node:test";
import { isE164, normalizeUsPhone } from "./phone";

// These cases are the same ones frontend/packages/shared/src/phone.test.ts
// pins, on purpose. The two normalizers are separate copies because the
// Function App does not build the frontend workspace, and the only thing
// keeping them from drifting is that both files assert the same answers.

test("a number typed the way a rider writes it becomes E.164", () => {
  for (const typed of ["9523883275", "952-388-3275", "(952) 388-3275", " 952 388 3275 ", "952.388.3275"]) {
    assert.equal(normalizeUsPhone(typed), "+19523883275", typed);
  }
});

test("a leading 1 is a country code, not an eleventh digit", () => {
  assert.equal(normalizeUsPhone("1 952 388 3275"), "+19523883275");
  assert.equal(normalizeUsPhone("1-952-388-3275"), "+19523883275");
});

test("an explicit + keeps the country the caller claimed", () => {
  assert.equal(normalizeUsPhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizeUsPhone("+1 (952) 388-3275"), "+19523883275");
});

test("digits that cannot be a number are null, not a guess", () => {
  // Nine digits and twelve are both nearly a US number, and "nearly" is what
  // produces a lookup against a number that cannot exist.
  for (const typed of ["", "   ", "952388327", "95238832751", "not a phone", "+", "+0123456789"]) {
    assert.equal(normalizeUsPhone(typed), null, typed);
  }
});

test("isE164 accepts what the API stores and nothing else", () => {
  assert.equal(isE164("+19523883275"), true);
  assert.equal(isE164("9523883275"), false);
  assert.equal(isE164("+0952388327"), false);
});
