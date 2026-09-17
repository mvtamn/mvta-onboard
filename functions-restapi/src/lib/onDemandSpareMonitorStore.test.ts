import assert from "node:assert/strict";
import test from "node:test";
import { admitOnDemandRequest } from "./onDemandRequestSource";
import { storeOnDemandSpareRequest, type ActiveOperationalZones } from "./onDemandSpareMonitorStore";

// Scope is no longer checked here: the store's parameter type accepts only a
// request onDemandRequestSource admitted, so an unscoped write does not compile
// (onDemandRequestSource.test.ts covers the admission itself).

const noZones: ActiveOperationalZones = { snapshot: { version: "", zones: [] }, databaseIds: new Map() };

test("a zone gap is reported as not applied, never thrown", async () => {
  // No database is configured in unit tests, so a call that reached a query
  // would throw rather than return: the outcome proves it stopped first.
  const admission = admitOnDemandRequest(
    { id: "req-1", serviceId: "svc-a", updatedAt: 1_757_000_000, scheduledPickupTs: 1_757_000_600 },
    { active: true, serviceIds: new Set(["svc-a"]) },
  );
  assert.ok(admission.admit);
  assert.equal(await storeOnDemandSpareRequest(admission.request, noZones), "no_active_zones");
});
