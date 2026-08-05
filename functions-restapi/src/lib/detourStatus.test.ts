import { test } from "node:test";
import assert from "node:assert";
import { computeDetourStatus } from "./detourStatus";

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
