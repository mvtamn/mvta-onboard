import { test } from "node:test";
import assert from "node:assert";
import { mapVehiclePositionEntity, vehicleObservedAt, VEHICLE_CLOCK_TOLERANCE_SECONDS, type GtfsRtVehiclePositionEntity } from "./gtfsVehiclePositions";

// Fixture shaped like MVTA's live feed (sampled 2026-07-24, mid-service).
const IN_TRANSIT: GtfsRtVehiclePositionEntity = {
  Id: "4057",
  TripUpdate: null,
  Vehicle: {
    Trip: { TripId: "t3A7-b26-sl2B-v62", RouteId: "475", schedule_relationship: 0 },
    Vehicle: { Id: "4057", Label: "4057" },
    Position: { Latitude: 44.88038, Longitude: -93.24686, Bearing: 0.0, Speed: 26.8224 },
    CurrentStopSequence: 1919,
    StopId: "13223",
    CurrentStatus: 2,
    Timestamp: 1784904788,
    congestion_level: 0,
    occupancy_status: 0,
  },
  Alert: null,
};

test("maps a vehicle position reading", () => {
  const mapped = mapVehiclePositionEntity(IN_TRANSIT);
  assert.ok(mapped);
  assert.strictEqual(mapped!.trip_id, "t3A7-b26-sl2B-v62");
  assert.strictEqual(mapped!.latitude, 44.88038);
  assert.strictEqual(mapped!.longitude, -93.24686);
  assert.strictEqual(mapped!.bearing, 0.0);
  assert.strictEqual(mapped!.speed_mps, 26.8224);
  assert.strictEqual(mapped!.occupancy_status, 0);
  assert.strictEqual(mapped!.current_status, 2);
});

test("returns null when Vehicle is missing", () => {
  const entity: GtfsRtVehiclePositionEntity = { Id: "x", TripUpdate: null, Vehicle: null, Alert: null };
  assert.strictEqual(mapVehiclePositionEntity(entity), null);
});

test("returns null when the vehicle has no assigned trip", () => {
  const entity: GtfsRtVehiclePositionEntity = {
    ...IN_TRANSIT,
    Vehicle: { ...IN_TRANSIT.Vehicle!, Trip: null },
  };
  assert.strictEqual(mapVehiclePositionEntity(entity), null);
});

test("returns null when there is no position fix", () => {
  const entity: GtfsRtVehiclePositionEntity = {
    ...IN_TRANSIT,
    Vehicle: { ...IN_TRANSIT.Vehicle!, Position: null },
  };
  assert.strictEqual(mapVehiclePositionEntity(entity), null);
});

test("handles a stopped vehicle with zero speed", () => {
  const entity: GtfsRtVehiclePositionEntity = {
    Id: "4051",
    TripUpdate: null,
    Vehicle: {
      Trip: { TripId: "t3ED-b25-sl2B-v62", RouteId: "465", schedule_relationship: 0 },
      Vehicle: { Id: "4051", Label: "4051" },
      Position: { Latitude: 44.97753, Longitude: -93.22677, Bearing: 212.0, Speed: 0.0 },
      CurrentStopSequence: 0,
      StopId: "49884",
      CurrentStatus: 1,
      Timestamp: 1784904790,
      congestion_level: 0,
      occupancy_status: 0,
    },
    Alert: null,
  };
  const mapped = mapVehiclePositionEntity(entity);
  assert.strictEqual(mapped!.speed_mps, 0.0);
  assert.strictEqual(mapped!.current_status, 1);
});

// --- the vehicle's own clock ------------------------------------------------
//
// From the end of daylight saving on 2026-11-01, AVL units still on CDT stamped
// their positions an hour ahead: 22 vehicles on 11-01, 54 on 11-02, 3 on 11-03.
// Stored as the observation time, those stamps put first_underway_at an hour
// late and escalated buses that left on time (t483-b4-sl1C-v65, 2026-11-03:
// written 18:35:15, stamped 19:19:45).
const FETCHED_AT = new Date("2026-11-03T18:35:15.000Z");

test("a position stamped in the future is observed when it was fetched", () => {
  const stamped = new Date("2026-11-03T19:19:45.000Z");
  assert.deepStrictEqual(vehicleObservedAt(stamped, FETCHED_AT), { at: FETCHED_AT, futureStamped: true });
});

test("a position stamped at or before the fetch keeps its own time", () => {
  const stamped = new Date("2026-11-03T18:34:58.000Z");
  assert.deepStrictEqual(vehicleObservedAt(stamped, FETCHED_AT), { at: stamped, futureStamped: false });
});

test("a vehicle clock a little ahead of ours is clock drift, not a wrong clock", () => {
  const stamped = new Date(FETCHED_AT.getTime() + VEHICLE_CLOCK_TOLERANCE_SECONDS * 1000);
  assert.deepStrictEqual(vehicleObservedAt(stamped, FETCHED_AT), { at: stamped, futureStamped: false });
});

test("a position with no timestamp is observed when it was fetched", () => {
  assert.deepStrictEqual(vehicleObservedAt(null, FETCHED_AT), { at: FETCHED_AT, futureStamped: false });
});
