import { test } from "node:test";
import assert from "node:assert";
import {
  formatDetourNumber,
  detourNumberYear,
  parseDetourNumberYear,
  hasDetourNumberYearMismatch,
} from "./detourNumbering";

test("formats to MVTA-DET-YYYY-#### with zero padding", () => {
  assert.strictEqual(formatDetourNumber(2026, 1), "MVTA-DET-2026-0001");
  assert.strictEqual(formatDetourNumber(2026, 42), "MVTA-DET-2026-0042");
  assert.strictEqual(formatDetourNumber(2026, 9999), "MVTA-DET-2026-9999");
});

test("widens rather than wrapping past 9999", () => {
  // Wrapping back to 0001 would collide with an already-issued number.
  assert.strictEqual(formatDetourNumber(2026, 10000), "MVTA-DET-2026-10000");
});

test("takes the year from start_date when set", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  assert.strictEqual(detourNumberYear("2027-03-01", now), 2027);
});

test("falls back to the current year for an open-ended detour", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  assert.strictEqual(detourNumberYear(null, now), 2026);
  assert.strictEqual(detourNumberYear(undefined, now), 2026);
});

// new Date("2026-01-01") is midnight UTC, which is still 2025 anywhere behind
// UTC - parsing the string prefix avoids issuing a 2025 number for a 2026
// detour depending on where the Function App happens to run.
test("a Jan 1 start_date does not slip into the previous year", () => {
  const now = new Date("2025-12-20T00:00:00.000Z");
  assert.strictEqual(detourNumberYear("2026-01-01", now), 2026);
});

test("parses the issued year back out, and rejects malformed input", () => {
  assert.strictEqual(parseDetourNumberYear("MVTA-DET-2026-0001"), 2026);
  assert.strictEqual(parseDetourNumberYear("MVTA-DET-2026-10000"), 2026);
  assert.strictEqual(parseDetourNumberYear(null), null);
  assert.strictEqual(parseDetourNumberYear("951"), null);
  assert.strictEqual(parseDetourNumberYear("MVTA-DET-2026"), null);
});

test("flags a detour rescheduled into a different year than its number", () => {
  assert.strictEqual(hasDetourNumberYearMismatch("MVTA-DET-2026-0001", "2027-01-15"), true);
  assert.strictEqual(hasDetourNumberYearMismatch("MVTA-DET-2026-0001", "2026-12-31"), false);
});

test("does not flag rows with no number or no start_date", () => {
  // Pre-migration-024 rows, and open-ended detours, must not warn.
  assert.strictEqual(hasDetourNumberYearMismatch(null, "2027-01-15"), false);
  assert.strictEqual(hasDetourNumberYearMismatch("MVTA-DET-2026-0001", null), false);
});
