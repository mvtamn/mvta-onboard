import { test } from "node:test";
import assert from "node:assert";
import {
  validateUpdateMessage,
  validateExpirationDefault,
  isGuid,
  MAX_SUMMARY_LENGTH,
  MIN_TTL_MINUTES,
  MAX_TTL_MINUTES,
} from "./validation";

test("update: accepts summary only", () => {
  assert.deepStrictEqual(validateUpdateMessage({ summary: "Updated summary" }), []);
});

test("update: accepts expires_at only", () => {
  assert.deepStrictEqual(validateUpdateMessage({ expires_at: "2026-08-01T12:00:00Z" }), []);
});

test("update: rejects empty body", () => {
  const errors = validateUpdateMessage({});
  assert.ok(errors.some((e) => e.includes("At least one")));
});

test("update: rejects oversized summary", () => {
  const errors = validateUpdateMessage({ summary: "x".repeat(MAX_SUMMARY_LENGTH + 1) });
  assert.ok(errors.some((e) => e.includes("summary")));
});

test("update: rejects unparseable expires_at", () => {
  const errors = validateUpdateMessage({ expires_at: "not-a-date" });
  assert.ok(errors.some((e) => e.includes("expires_at")));
});

test("expiration default: accepts valid ttl", () => {
  assert.deepStrictEqual(validateExpirationDefault({ default_ttl_minutes: 240 }), []);
});

test("expiration default: rejects non-integer", () => {
  const errors = validateExpirationDefault({ default_ttl_minutes: 12.5 });
  assert.ok(errors.some((e) => e.includes("integer")));
});

test("expiration default: rejects out-of-range ttl", () => {
  assert.ok(validateExpirationDefault({ default_ttl_minutes: MIN_TTL_MINUTES - 1 }).length > 0);
  assert.ok(validateExpirationDefault({ default_ttl_minutes: MAX_TTL_MINUTES + 1 }).length > 0);
});

test("expiration default: rejects missing ttl", () => {
  assert.ok(validateExpirationDefault({}).length > 0);
});

test("isGuid accepts a valid GUID and rejects junk", () => {
  assert.ok(isGuid("7e5a35b1-dc1b-473d-987d-6942a7b4fae2"));
  assert.ok(!isGuid("not-a-guid"));
  assert.ok(!isGuid("7e5a35b1dc1b473d987d6942a7b4fae2"));
  assert.ok(!isGuid(42));
});
