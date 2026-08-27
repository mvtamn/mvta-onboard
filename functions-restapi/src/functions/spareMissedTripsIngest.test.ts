import assert from "node:assert/strict";
import test from "node:test";
import { fetchSlotsForRequestDuties } from "./spareMissedTripsIngest";

test("fetches pickup slots once for each non-empty request duty", async () => {
  const calls: Array<[string, number]> = [];
  const slots = await fetchSlotsForRequestDuties([
    { dutyId: "duty-1" },
    { dutyId: " duty-1 " },
    { lockedToDutyId: "duty-2" },
    { dutyId: "" },
    {},
  ], 100, async (dutyId, rowsPerDuty) => {
    calls.push([dutyId, rowsPerDuty]);
    return [{ id: `${dutyId}-slot`, dutyId, type: "pickup", updatedAt: 1 }];
  });

  assert.deepEqual(calls, [["duty-1", 50], ["duty-2", 50]]);
  assert.deepEqual(slots.map((slot) => slot.dutyId), ["duty-1", "duty-2"]);
});

test("does not fetch slots when requests have no duty", async () => {
  let calls = 0;
  const slots = await fetchSlotsForRequestDuties([{ id: "request-1" }, { dutyId: "" }], 100, async () => {
    calls++;
    return [];
  });

  assert.equal(calls, 0);
  assert.deepEqual(slots, []);
});
