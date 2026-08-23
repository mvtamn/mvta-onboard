import assert from "node:assert/strict";
import test from "node:test";
import { depotTestIsActive, formatDepotDepartureTestMessage, reportOccurredDuringDepotTest } from "./depotDepartureTest";

test("formats a clearly marked depot departure test message", () => {
  assert.match(formatDepotDepartureTestMessage({ vehicleId: 4136, routeId: 1132, locationName: "Eagan Bus Garage", geofenceName: "Garage Exit", exitedAt: "2026-08-22T21:34:00Z" }), /^\[TEST\] Bus 4136 on Route 1132 exited Garage Exit at Eagan Bus Garage\./);
});

test("expires depot tests at their configured end time", () => {
  const now = new Date("2026-08-22T21:34:00Z");
  assert.equal(depotTestIsActive("2026-08-22T21:34:01Z", now), true);
  assert.equal(depotTestIsActive("2026-08-22T21:34:00Z", now), false);
});

test("uses only reports observed after the depot test was enabled", () => {
  const enabledAt = "2026-08-22T21:34:00Z";
  assert.equal(reportOccurredDuringDepotTest("2026-08-22T21:33:59Z", enabledAt), false);
  assert.equal(reportOccurredDuringDepotTest(enabledAt, enabledAt), false);
  assert.equal(reportOccurredDuringDepotTest("2026-08-22T21:34:01Z", enabledAt), true);
});
