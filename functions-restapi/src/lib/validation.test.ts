import { test } from "node:test";
import assert from "node:assert";
import { validateCreateMessage, MAX_SUMMARY_LENGTH, MAX_CREATED_BY_LENGTH } from "./validation";

test("valid message passes with no errors", () => {
  const errors = validateCreateMessage({
    raw_text: "Elevator out of service",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.deepStrictEqual(errors, []);
});

test("rejects missing raw_text", () => {
  const errors = validateCreateMessage({
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.ok(errors.some((e) => e.includes("raw_text")));
});

test("rejects invalid category", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "not_a_real_category",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.ok(errors.some((e) => e.includes("category")));
});

test("rejects invalid severity", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "super-duper-bad",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.ok(errors.some((e) => e.includes("severity")));
});

test("rejects unparseable expires_at", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "not-a-date",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.ok(errors.some((e) => e.includes("expires_at")));
});

test("rejects non-array routes_affected", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
    routes_affected: "Route 5",
  });
  assert.ok(errors.some((e) => e.includes("routes_affected")));
});

test("rejects summary longer than the column allows", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
    summary: "x".repeat(MAX_SUMMARY_LENGTH + 1),
  });
  assert.ok(errors.some((e) => e.includes("summary")));
});

test("accepts summary exactly at the column limit", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
    summary: "x".repeat(MAX_SUMMARY_LENGTH),
  });
  assert.deepStrictEqual(errors, []);
});

test("rejects created_by longer than the column allows", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "x".repeat(MAX_CREATED_BY_LENGTH + 1),
  });
  assert.ok(errors.some((e) => e.includes("created_by")));
});

test("created_by is optional - omitting it entirely still validates", () => {
  // The server always derives created_by from the verified auth principal
  // (see messagesCreate.ts), never from the client body, so the frontend
  // legitimately never sends this field for a human caller.
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
  });
  assert.deepStrictEqual(errors, []);
});

test("accepts null optional array fields", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "general",
    severity: "informational",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "category_default",
    created_by: "delay_detection",
    routes_affected: null,
    tags: null,
  });
  assert.deepStrictEqual(errors, []);
});
