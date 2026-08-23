import assert from "node:assert/strict";
import test from "node:test";
import { monitoringAreaTestIsActive, formatMonitoringAreaTestMessage, reportOccurredDuringMonitoringAreaTest } from "./monitoringAreaTest";

test("formats a clearly marked Monitoring Area test message", () => {
  assert.match(formatMonitoringAreaTestMessage({ vehicleId: 4136, routeId: 1132, locationName: "Corridor reference", geofenceName: "Ren Fest corridor", exitedAt: "2026-08-22T21:34:00Z" }), /^\[TEST\] Bus 4136 on Route 1132 exited Ren Fest corridor at Corridor reference\./);
});

test("expires Monitoring Area tests at their configured end time", () => {
  const now = new Date("2026-08-22T21:34:00Z");
  assert.equal(monitoringAreaTestIsActive("2026-08-22T21:34:01Z", now), true);
  assert.equal(monitoringAreaTestIsActive("2026-08-22T21:34:00Z", now), false);
});

test("uses only reports observed after the Monitoring Area test was enabled", () => {
  const enabledAt = "2026-08-22T21:34:00Z";
  assert.equal(reportOccurredDuringMonitoringAreaTest("2026-08-22T21:33:59Z", enabledAt), false);
  assert.equal(reportOccurredDuringMonitoringAreaTest(enabledAt, enabledAt), false);
  assert.equal(reportOccurredDuringMonitoringAreaTest("2026-08-22T21:34:01Z", enabledAt), true);
});
