import { test } from "node:test";
import assert from "node:assert";
import { mapVehiclePositionEntity, type GtfsRtVehiclePositionEntity } from "./gtfsVehiclePositions";

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
