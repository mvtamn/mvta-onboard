import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DEAD_ZONE_BAR, deadZoneBarFrom, isLikelyDeadZone } from "./deadZone";

test("the default bar is five other cases, 80% of them run", () => {
  assert.deepEqual(DEFAULT_DEAD_ZONE_BAR, { ran_percent: 80, min_cases: 5 });
});

test("a stop meets the bar at exactly the share and the count", () => {
  assert.equal(isLikelyDeadZone(5, 4, DEFAULT_DEAD_ZONE_BAR), true);
  assert.equal(isLikelyDeadZone(4, 4, DEFAULT_DEAD_ZONE_BAR), false, "too few cases, however they went");
  assert.equal(isLikelyDeadZone(24, 17, DEFAULT_DEAD_ZONE_BAR), false, "Mystic Lake at 71%");
  assert.equal(isLikelyDeadZone(24, 17, { ran_percent: 70, min_cases: 5 }), true, "the same stop under a 70% bar");
});

test("no cases is never a dead zone, even with a bar of zero cases", () => {
  assert.equal(isLikelyDeadZone(0, 0, { ran_percent: 50, min_cases: 0 }), false);
});

test("the bar is read from its two settings", () => {
  const bar = deadZoneBarFrom([
    { setting_key: "dead_zone_ran_percent", setting_value: "70" },
    { setting_key: "dead_zone_min_cases", setting_value: "8" },
  ]);
  assert.deepEqual(bar, { ran_percent: 70, min_cases: 8, configured: true });
});

test("a missing or unreadable setting falls back to its default, alone", () => {
  assert.deepEqual(deadZoneBarFrom([]), { ...DEFAULT_DEAD_ZONE_BAR, configured: false });
  assert.deepEqual(
    deadZoneBarFrom([
      { setting_key: "dead_zone_ran_percent", setting_value: "seventy" },
      { setting_key: "dead_zone_min_cases", setting_value: "8" },
    ]),
    { ran_percent: 80, min_cases: 8, configured: true },
  );
  // Out of the range migration 155 declares: a value the console could never
  // have saved is not trusted either.
  assert.deepEqual(
    deadZoneBarFrom([
      { setting_key: "dead_zone_ran_percent", setting_value: "20" },
      { setting_key: "dead_zone_min_cases", setting_value: "500" },
    ]),
    { ...DEFAULT_DEAD_ZONE_BAR, configured: true },
  );
});
