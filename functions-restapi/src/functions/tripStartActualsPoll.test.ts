import test from "node:test";
import assert from "node:assert/strict";
import type { GtfsRtTripUpdate } from "../lib/gtfsTripUpdates";
import { indexTripUpdates, lookupTripUpdate } from "./tripStartActualsPoll";

function update(tripId: string, startDate: string): GtfsRtTripUpdate {
  return {
    Trip: { TripId: tripId, RouteId: "444", StartDate: startDate, schedule_relationship: 0 },
    Vehicle: null,
    StopTimeUpdates: [],
    Timestamp: 0,
  };
}

test("finds a trip's update by service date and trip id, the way the log is keyed", () => {
  const index = indexTripUpdates([
    { TripUpdate: update("t1", "20260905") },
    { TripUpdate: update("t1", "20260904") }, // yesterday's late trip, same id
    { TripUpdate: null },
  ]);
  assert.equal(lookupTripUpdate(index, "20260905", "t1")?.Trip.StartDate, "20260905");
  assert.equal(lookupTripUpdate(index, "20260904", "t1")?.Trip.StartDate, "20260904");
  assert.equal(lookupTripUpdate(index, "20260903", "t9"), null);
});

// Dev, 2026-09-22 to 10-21: route 495's 23:02 trip was still in the feed after
// midnight under yesterday's StartDate, and the bare-id fallback handed it to
// the new day's row of the same trip id - 19 starts logged ~23 hours early.
test("never hands one service date's update to another date's row", () => {
  const index = indexTripUpdates([{ TripUpdate: update("t8FE", "20260921") }]);
  assert.equal(lookupTripUpdate(index, "20260922", "t8FE"), null);
});

test("falls back to the trip id alone when the producer omits the start date", () => {
  const index = indexTripUpdates([{ TripUpdate: update("t2", "") }]);
  assert.equal(lookupTripUpdate(index, "20260905", "t2")?.Trip.TripId, "t2");
});
