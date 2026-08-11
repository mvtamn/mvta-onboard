import test from "node:test";
import assert from "node:assert/strict";
import { validateOperatingPeriod } from "./eventOperatingPeriods.js";

test("accepts an overnight MVTA operating period", () => {
  const result = validateOperatingPeriod({
    start_at: "2026-06-14T14:00:00-05:00",
    end_at: "2026-06-15T01:00:00-05:00",
  });
  assert.equal(result.valid, true);
});

test("rejects a period whose end is not after its start", () => {
  const result = validateOperatingPeriod({
    start_at: "2026-06-15T01:00:00-05:00",
    end_at: "2026-06-14T14:00:00-05:00",
  });
  assert.deepEqual(result, { valid: false, error: "start_at must be before end_at" });
});

test("rejects missing or malformed timestamps", () => {
  assert.deepEqual(validateOperatingPeriod({ start_at: null, end_at: null }), {
    valid: false,
    error: "start_at and end_at are required",
  });
  assert.deepEqual(validateOperatingPeriod({ start_at: "not-a-date", end_at: "2026-06-15T01:00:00Z" }), {
    valid: false,
    error: "start_at and end_at must be valid timestamps",
  });
});
