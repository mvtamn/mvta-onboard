import { test } from "node:test";
import assert from "node:assert";
import { computeDetourStatus, toDateOnly, toTimeOnly } from "./detourStatus";

const TODAY = "2026-08-10";

test("monitor-only always returns monitor regardless of dates", () => {
  assert.strictEqual(
    computeDetourStatus({ start_date: "2026-01-01", end_date: "2026-01-02", is_monitor_only: true }, TODAY),
    "monitor",
  );
  assert.strictEqual(
    computeDetourStatus({ start_date: null, end_date: null, is_monitor_only: true }, TODAY),
    "monitor",
  );
});

test("no start_date on a real closure defaults to active", () => {
  assert.strictEqual(
    computeDetourStatus({ start_date: null, end_date: null, is_monitor_only: false }, TODAY),
    "active",
  );
});

test("start_date in the future is upcoming", () => {
  assert.strictEqual(
    computeDetourStatus({ start_date: "2026-08-11", end_date: null, is_monitor_only: false }, TODAY),
    "upcoming",
  );
});

test("open-ended (no end_date) with a past start_date is active", () => {
  assert.strictEqual(
    computeDetourStatus({ start_date: "2026-01-01", end_date: null, is_monitor_only: false }, TODAY),
    "active",
  );
});

test("today within [start_date, end_date] is active, including the boundary day", () => {
  assert.strictEqual(
    computeDetourStatus({ start_date: "2026-08-01", end_date: "2026-08-10", is_monitor_only: false }, TODAY),
    "active",
  );
});

test("today just past end_date (within the grace window) is recently_finished", () => {
  assert.strictEqual(
    computeDetourStatus({ start_date: "2026-08-01", end_date: "2026-08-09", is_monitor_only: false }, TODAY),
    "recently_finished",
  );
  // exactly at the 7-day boundary
  assert.strictEqual(
    computeDetourStatus({ start_date: "2026-08-01", end_date: "2026-08-03", is_monitor_only: false }, TODAY),
    "recently_finished",
  );
});

test("today well past the grace window is expired", () => {
  assert.strictEqual(
    computeDetourStatus({ start_date: "2026-07-01", end_date: "2026-07-15", is_monitor_only: false }, TODAY),
    "expired",
  );
});

// The tests above all pass plain YYYY-MM-DD strings - which is exactly how
// this file's real bug survived. What the mssql driver ACTUALLY hands back
// for a DATE column is a JS Date, and comparing a string against a Date
// coerces to NaN, which is false in both directions: every detour fell
// through to "recently_finished" no matter its dates, so the console showed
// no Active detours at all. These cases pin the driver's real shapes.

test("Date objects (what the mssql driver really returns) classify identically to strings", () => {
  const asDates = {
    start_date: new Date("2026-08-01T00:00:00.000Z"),
    end_date: new Date("2026-08-10T00:00:00.000Z"),
    is_monitor_only: false,
  };
  assert.strictEqual(computeDetourStatus(asDates, TODAY), "active");

  // The exact regression from live data: a detour still months from ending
  // was being reported as recently_finished.
  assert.strictEqual(
    computeDetourStatus(
      { start_date: new Date("2026-07-06T00:00:00.000Z"), end_date: new Date("2026-10-31T00:00:00.000Z"), is_monitor_only: false },
      "2026-08-07",
    ),
    "active",
  );

  assert.strictEqual(
    computeDetourStatus(
      { start_date: new Date("2026-09-01T00:00:00.000Z"), end_date: null, is_monitor_only: false },
      TODAY,
    ),
    "upcoming",
  );
  assert.strictEqual(
    computeDetourStatus(
      { start_date: new Date("2026-07-01T00:00:00.000Z"), end_date: new Date("2026-07-15T00:00:00.000Z"), is_monitor_only: false },
      TODAY,
    ),
    "expired",
  );
});

test("full ISO timestamp strings classify identically to date-only strings", () => {
  assert.strictEqual(
    computeDetourStatus(
      { start_date: "2026-08-01T00:00:00.000Z", end_date: "2026-08-10T00:00:00.000Z", is_monitor_only: false },
      TODAY,
    ),
    "active",
  );
});

test("toDateOnly reduces every shape the driver can produce, and rejects junk", () => {
  assert.strictEqual(toDateOnly(new Date("2026-08-08T00:00:00.000Z")), "2026-08-08");
  assert.strictEqual(toDateOnly("2026-08-08T00:00:00.000Z"), "2026-08-08");
  assert.strictEqual(toDateOnly("2026-08-08"), "2026-08-08");
  assert.strictEqual(toDateOnly(null), null);
  assert.strictEqual(toDateOnly(undefined), null);
  assert.strictEqual(toDateOnly(""), null);
  assert.strictEqual(toDateOnly("not a date"), null);
  assert.strictEqual(toDateOnly(new Date("nonsense")), null);
});

test("toTimeOnly reduces the driver's 1970-pinned TIME Date to HH:MM", () => {
  assert.strictEqual(toTimeOnly(new Date("1970-01-01T14:30:00.000Z")), "14:30");
});

test("toTimeOnly accepts HH:MM, HH:MM:SS, and ISO timestamp strings", () => {
  assert.strictEqual(toTimeOnly("06:05"), "06:05");
  assert.strictEqual(toTimeOnly("06:05:59"), "06:05");
  assert.strictEqual(toTimeOnly("1970-01-01T22:15:00.000Z"), "22:15");
});

test("toTimeOnly returns null for empty, invalid, or non-time input", () => {
  assert.strictEqual(toTimeOnly(null), null);
  assert.strictEqual(toTimeOnly(undefined), null);
  assert.strictEqual(toTimeOnly(""), null);
  assert.strictEqual(toTimeOnly("noon"), null);
  assert.strictEqual(toTimeOnly(new Date("garbage")), null);
});
