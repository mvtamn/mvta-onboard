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

test("falls back to the trip id alone when the producer omits the start date", () => {
  const index = indexTripUpdates([{ TripUpdate: update("t2", "") }]);
  assert.equal(lookupTripUpdate(index, "20260905", "t2")?.Trip.TripId, "t2");
});
