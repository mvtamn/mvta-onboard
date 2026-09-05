import assert from "node:assert/strict";
import test from "node:test";
import { resolveOnDemandDeparture, startLocationSlot } from "./onDemandDepartures";

const T0 = 1_788_000_000; // an arbitrary epoch-seconds base

test("measures the departure from the duty's startLocation slot when Spare has one", () => {
  const resolved = resolveOnDemandDeparture(
    { id: "duty-1", identifier: "D-101", driverId: "drv-1", vehicleId: "veh-1", status: "inProgress", updatedAt: T0 + 100,
      startRequestedTs: T0 - 300, metrics: { firstSeenInServiceAreaTs: T0 + 900 } },
    [
      { id: "slot-pickup", dutyId: "duty-1", type: "pickup", scheduledTs: T0 + 1200, updatedAt: T0 },
      { id: "slot-start", dutyId: "duty-1", type: "startLocation", scheduledTs: T0, startedTs: T0 + 240, updatedAt: T0 + 250 },
    ],
  );
  assert.ok(resolved);
  assert.equal(resolved.dutyId, "duty-1");
  assert.equal(resolved.dutyIdentifier, "D-101");
  assert.equal(resolved.departureScheduled?.getTime(), T0 * 1000);
  assert.equal(resolved.scheduledSource, "slots_startLocation");
  assert.equal(resolved.departureActual?.getTime(), (T0 + 240) * 1000);
  assert.equal(resolved.departureSource, "slots_startLocation");
  assert.equal(resolved.slotId, "slot-start");
  // The newest of the duty and the slot, so a re-fetch cannot go backwards.
  assert.equal(resolved.sourceUpdatedAt?.getTime(), (T0 + 250) * 1000);
});

test("falls back to first-seen-in-service-area when the slot has not been started", () => {
  const resolved = resolveOnDemandDeparture(
    { id: "duty-2", metrics: { firstSeenInServiceAreaTs: T0 + 600 } },
    [{ id: "slot-start", dutyId: "duty-2", type: "startLocation", scheduledTs: T0 }],
  );
  assert.ok(resolved);
  assert.equal(resolved.departureScheduled?.getTime(), T0 * 1000);
  assert.equal(resolved.scheduledSource, "slots_startLocation");
  assert.equal(resolved.departureActual?.getTime(), (T0 + 600) * 1000);
  assert.equal(resolved.departureSource, "duties_firstSeenInServiceArea");
});

test("uses the duty's requested start as the schedule when there is no startLocation slot", () => {
  const resolved = resolveOnDemandDeparture(
    { id: "duty-3", startRequestedTs: T0, metrics: { firstSeenInServiceAreaTs: T0 + 60 } },
    [{ id: "slot-pickup", dutyId: "duty-3", type: "pickup", scheduledTs: T0 + 900 }],
  );
  assert.ok(resolved);
  assert.equal(resolved.scheduledSource, "duties_startRequested");
  assert.equal(resolved.departureScheduled?.getTime(), T0 * 1000);
  assert.equal(resolved.departureSource, "duties_firstSeenInServiceArea");
  assert.equal(resolved.slotId, null);
});

test("leaves the actual empty, with no source, for a duty that has not departed", () => {
  const resolved = resolveOnDemandDeparture(
    { id: "duty-4", startRequestedTs: T0 },
    [{ id: "slot-start", dutyId: "duty-4", type: "startLocation", scheduledTs: T0 + 30 }],
  );
  assert.ok(resolved);
  assert.equal(resolved.departureActual, null);
  assert.equal(resolved.departureSource, null);
  assert.equal(resolved.departureScheduled?.getTime(), (T0 + 30) * 1000);
});

test("ignores cancelled start slots and picks the earliest remaining one", () => {
  const slot = startLocationSlot([
    { id: "cancelled", type: "startLocation", status: "cancelled", scheduledTs: T0 - 600 },
    { id: "later", type: "startLocation", scheduledTs: T0 + 3600 },
    { id: "first", type: "StartLocation", scheduledTs: T0 },
  ]);
  assert.equal(slot?.id, "first");
});

test("refuses a duty without an id", () => {
  assert.equal(resolveOnDemandDeparture({ identifier: "D-1" }, []), null);
});
