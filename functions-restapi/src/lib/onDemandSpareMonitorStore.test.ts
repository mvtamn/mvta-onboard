import assert from "node:assert/strict";
import test from "node:test";
import { storeOnDemandSpareRequest, type ActiveOperationalZones } from "./onDemandSpareMonitorStore";
import type { NormalizedOnDemandRequest } from "./onDemandSpareMonitor";

// One zone, so the store gets past its zone guard and reaches the scope
// backstop. No database is configured in unit tests, so any call that got as
// far as a query would throw rather than return - which is what makes these
// assertions meaningful: false means it stopped before the write.
const zones: ActiveOperationalZones = {
  snapshot: {
    version: "test",
    zones: [{
      externalLocationId: "location_id__test",
      name: "Test",
      version: "test",
      geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
    }],
  },
  databaseIds: new Map([["location_id__test", "00000000-0000-0000-0000-000000000001"]]),
};

function request(serviceId: string | null): NormalizedOnDemandRequest {
  return {
    requestId: "req-1",
    serviceId,
    dutyId: null,
    vehicleId: null,
    sourceUpdatedAt: new Date("2026-09-15T12:00:00Z"),
    originalPickupAt: null,
    commitmentAt: new Date("2026-09-15T12:10:00Z"),
    predictedPickupAt: null,
    pickupArrivedAt: null,
    pickupCoordinate: null,
    state: "active",
  };
}

test("the store writes nothing while on-demand monitoring is off", async () => {
  delete process.env.ON_DEMAND_MONITORING_ENABLED;
  assert.equal(await storeOnDemandSpareRequest(request("svc-a"), zones), false);
});

test("the store writes nothing for a service outside the monitored scope", async (t) => {
  process.env.ON_DEMAND_MONITORING_ENABLED = "true";
  process.env.ON_DEMAND_MONITORING_SERVICE_IDS = "svc-a";
  t.after(() => {
    delete process.env.ON_DEMAND_MONITORING_ENABLED;
    delete process.env.ON_DEMAND_MONITORING_SERVICE_IDS;
  });
  assert.equal(await storeOnDemandSpareRequest(request("svc-b"), zones), false);
  assert.equal(await storeOnDemandSpareRequest(request(null), zones), false);
});

test("an enabled monitor with no scope writes nothing either", async (t) => {
  process.env.ON_DEMAND_MONITORING_ENABLED = "true";
  process.env.ON_DEMAND_MONITORING_SERVICE_IDS = "";
  t.after(() => {
    delete process.env.ON_DEMAND_MONITORING_ENABLED;
    delete process.env.ON_DEMAND_MONITORING_SERVICE_IDS;
  });
  assert.equal(await storeOnDemandSpareRequest(request("svc-a"), zones), false);
});
