import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOnDemandSpareRequest, normalizeSpareDutyMatchingStatus, normalizeSpareEtaUpdates, normalizeSpareVehicleLocation } from "./onDemandSpareMonitor";

test("normalizes the scheduled pickup commitment without retaining pickup details", () => {
  const request = normalizeOnDemandSpareRequest({
    id: "request-42", updatedAt: 1786201200, requestedPickupTs: 1786200000,
    initialScheduledPickupTs: 1786200300, scheduledPickupTs: 1786200600,
    estimatedPickupTime: 1786201500, dutyId: "duty-7", pickupLocation: { longitude: -93.3, latitude: 44.8 },
  });
  assert.deepEqual(request && {
    requestId: request.requestId,
    dutyId: request.dutyId,
    commitmentAt: request.commitmentAt.toISOString(),
    originalPickupAt: request.originalPickupAt?.toISOString(),
    predictedPickupAt: request.predictedPickupAt?.toISOString(),
    pickupCoordinate: request.pickupCoordinate,
    state: request.state,
  }, {
    requestId: "request-42", dutyId: "duty-7", commitmentAt: "2026-08-08T14:50:00.000Z",
    originalPickupAt: "2026-08-08T14:45:00.000Z", predictedPickupAt: "2026-08-08T15:05:00.000Z",
    pickupCoordinate: [-93.3, 44.8], state: "active",
  });
});

test("marks pickup or cancellation as terminal so stale retries cannot reopen it", () => {
  assert.equal(normalizeOnDemandSpareRequest({ id: "r", updatedAt: 1, scheduledPickupTs: 1, pickupArrivedTs: 2 })?.state, "completed");
  assert.equal(normalizeOnDemandSpareRequest({ id: "r", updatedAt: 1, scheduledPickupTs: 1, status: "cancelled" })?.state, "cancelled");
});

test("accepts the standard GeoJSON pickup coordinate shape", () => {
  assert.deepEqual(normalizeOnDemandSpareRequest({
    id: "r", updatedAt: 1, scheduledPickupTs: 1,
    pickupLocation: { type: "Point", coordinates: [-93.3, 44.8] },
  })?.pickupCoordinate, [-93.3, 44.8]);
});

test("normalizes ETA update identifiers and timestamps only", () => {
  assert.deepEqual(normalizeSpareEtaUpdates({ updates: [{ requestId: "r", pickupETA: 1786201200, dropoffETA: 1786201800 }] }), [{
    requestId: "r", pickupAt: new Date("2026-08-08T15:00:00.000Z"), dropoffAt: new Date("2026-08-08T15:10:00.000Z"),
  }]);
});

test("normalizes duty telemetry without retaining location data", () => {
  assert.deepEqual(normalizeSpareVehicleLocation({ dutyId: "duty-7", vehicleId: "van-4", updatedAt: 1786201200, location: { latitude: 44.8 } }), {
    dutyId: "duty-7", vehicleId: "van-4", updatedAt: new Date("2026-08-08T15:00:00.000Z"),
  });
  assert.deepEqual(normalizeSpareDutyMatchingStatus({ dutyId: "duty-7", isMatchingEnabled: false }), { dutyId: "duty-7", isMatchingEnabled: false });
});
