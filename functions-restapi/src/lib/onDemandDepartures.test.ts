import assert from "node:assert/strict";
import test from "node:test";
import { driverLabelFrom, DriverLabelResolver, labelsToBackfill, resolveOnDemandDeparture, startLocationSlot, VehicleLabelResolver } from "./onDemandDepartures";

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

test("resolves a vehicle's fleet number once and remembers it", async () => {
  let at = 1_000_000;
  const calls: string[] = [];
  const resolver = new VehicleLabelResolver(async (id) => { calls.push(id); return { id, identifier: " 1188 " }; }, 60_000, 10_000, () => at);
  assert.equal(await resolver.label("veh-1"), "1188");
  assert.equal(await resolver.label("veh-1"), "1188");
  assert.deepEqual(calls, ["veh-1"], "the second duty on the same vehicle costs no call");
  at += 60_001;
  assert.equal(await resolver.label("veh-1"), "1188");
  assert.deepEqual(calls, ["veh-1", "veh-1"], "re-read once the ttl has passed");
});

test("a failed vehicle read yields no label, is remembered briefly, and never throws", async () => {
  let at = 1_000_000;
  let calls = 0;
  const resolver = new VehicleLabelResolver(async () => { calls++; throw new Error("HTTP 404"); }, 60_000, 10_000, () => at);
  assert.equal(await resolver.label("veh-9"), null);
  assert.equal(await resolver.label("veh-9"), null);
  assert.equal(calls, 1, "the failure is remembered");
  at += 10_001;
  assert.equal(await resolver.label("veh-9"), null);
  assert.equal(calls, 2, "and retried after the shorter failure ttl");
});

test("a vehicle without an identifier is stored as unlabelled, not as its id", async () => {
  const resolver = new VehicleLabelResolver(async (id) => ({ id }));
  assert.equal(await resolver.label("veh-2"), null);
});

test("a driver label is the name in Last, First order with the identifier when Spare keeps one", () => {
  assert.deepEqual(driverLabelFrom({ id: "d1", firstName: " Amir ", lastName: "Delacroix", identifier: "144" }), { name: "Delacroix, Amir", identifier: "144" });
  assert.deepEqual(driverLabelFrom({ id: "d2", firstName: "Amir" }), { name: "Amir", identifier: null });
  assert.deepEqual(driverLabelFrom({ id: "d3", identifier: "302" }), { name: null, identifier: "302" });
  assert.equal(driverLabelFrom({ id: "d4" }), null, "a record with neither name nor identifier is no label");
});

test("a driver is read once per ttl and a failed read is remembered briefly", async () => {
  let at = 1_000_000;
  const calls: string[] = [];
  const resolver = new DriverLabelResolver(async (id) => { calls.push(id); return { id, firstName: "Amir", lastName: "Delacroix" }; }, 60_000, 10_000, () => at);
  assert.deepEqual(await resolver.label("drv-1"), { name: "Delacroix, Amir", identifier: null });
  await resolver.label("drv-1");
  assert.deepEqual(calls, ["drv-1"], "the second duty for the same driver costs no call");
  at += 60_001;
  await resolver.label("drv-1");
  assert.deepEqual(calls, ["drv-1", "drv-1"], "re-read once the ttl has passed");

  let failures = 0;
  const failing = new DriverLabelResolver(async () => { failures++; throw new Error("HTTP 404"); }, 60_000, 10_000, () => at);
  assert.equal(await failing.label("drv-9"), null);
  assert.equal(await failing.label("drv-9"), null);
  assert.equal(failures, 1, "the failure is remembered");
});

test("a stored departure is backfilled only for the labels it lacks and the columns that exist", () => {
  const bare = { driver_id: "drv-1", vehicle_id: "veh-1", vehicle_identifier: null, driver_name: null, driver_identifier: null };
  assert.deepEqual(labelsToBackfill(bare, true, true), { vehicle: true, driver: true });
  assert.deepEqual(labelsToBackfill(bare, false, true), { vehicle: false, driver: true }, "no vehicle column before migration 099");
  assert.deepEqual(labelsToBackfill(bare, true, false), { vehicle: true, driver: false }, "no driver columns before migration 100");
  assert.deepEqual(labelsToBackfill({ ...bare, vehicle_identifier: "1188", driver_name: "Delacroix, Amir" }, true, true), { vehicle: false, driver: false });
  assert.deepEqual(labelsToBackfill({ ...bare, driver_name: null, driver_identifier: "144" }, true, true).driver, false, "an identifier alone is a label");
  assert.deepEqual(labelsToBackfill({ ...bare, driver_id: null, vehicle_id: null }, true, true), { vehicle: false, driver: false }, "nothing to ask Spare about");
});
