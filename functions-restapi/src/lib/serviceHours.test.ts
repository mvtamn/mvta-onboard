import { test } from "node:test";
import assert from "node:assert";
import { fixedRouteTripsExpected } from "./serviceHours";

const at = (iso: string) => new Date(iso);

test("expects fixed-route trips from 4am, not before (daylight time, UTC-5)", () => {
  assert.strictEqual(fixedRouteTripsExpected(at("2026-09-14T08:59:00Z")), false, "03:59 CDT");
  assert.strictEqual(fixedRouteTripsExpected(at("2026-09-14T09:00:00Z")), true, "04:00 CDT");
  assert.strictEqual(fixedRouteTripsExpected(at("2026-09-14T17:00:00Z")), true, "noon CDT");
});

test("stops expecting them at 10pm, and not overnight (daylight time)", () => {
  assert.strictEqual(fixedRouteTripsExpected(at("2026-09-15T02:59:00Z")), true, "21:59 CDT");
  assert.strictEqual(fixedRouteTripsExpected(at("2026-09-15T03:00:00Z")), false, "22:00 CDT");
  assert.strictEqual(fixedRouteTripsExpected(at("2026-09-14T06:45:00Z")), false, "01:45 CDT");
});

// The window is agency wall-clock time, so it moves in UTC with the clocks.
test("keeps the same local window in standard time (UTC-6)", () => {
  assert.strictEqual(fixedRouteTripsExpected(at("2026-01-15T09:59:00Z")), false, "03:59 CST");
  assert.strictEqual(fixedRouteTripsExpected(at("2026-01-15T10:00:00Z")), true, "04:00 CST");
  assert.strictEqual(fixedRouteTripsExpected(at("2026-01-16T03:59:00Z")), true, "21:59 CST");
  assert.strictEqual(fixedRouteTripsExpected(at("2026-01-16T04:00:00Z")), false, "22:00 CST");
});

test("follows the clocks on the days they change", () => {
  // 2026-11-01: clocks fall back at 2am CDT -> 1am CST.
  assert.strictEqual(fixedRouteTripsExpected(at("2026-11-01T09:59:00Z")), false, "03:59 CST after fall back");
  assert.strictEqual(fixedRouteTripsExpected(at("2026-11-01T10:00:00Z")), true, "04:00 CST after fall back");
  // 2026-03-08: clocks spring forward at 2am CST -> 3am CDT.
  assert.strictEqual(fixedRouteTripsExpected(at("2026-03-08T08:59:00Z")), false, "03:59 CDT after spring forward");
  assert.strictEqual(fixedRouteTripsExpected(at("2026-03-08T09:00:00Z")), true, "04:00 CDT after spring forward");
});
