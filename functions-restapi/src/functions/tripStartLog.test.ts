import test from "node:test";
import assert from "node:assert/strict";
import { shapeTrip, TRIP_START_LOG_READ_ROLES } from "./tripStartLog";

const base = {
  service_date: "20260908",
  trip_id: "444-2-A-0320",
  block_id: "1",
  route_id: "444-2-A",
  route_short_name: "444",
  direction_id: 0,
  direction_label: "EB",
  origin_stop_id: "51234",
  origin_stop_name: "Apple Valley Transit Station",
  scheduled_start_seconds: 3 * 3600 + 20 * 60,
  scheduled_start_at: new Date("2026-09-08T08:20:00Z"),
  in_rotation: true,
  rotation_day: "tuesday",
  actual_start_at: null,
  actual_start_source: null,
  start_delay_seconds: null,
  start_status: null,
  predicted_start_at: null,
  materialized_at: new Date("2026-09-07T09:30:00Z"),
  updated_at: new Date("2026-09-07T09:30:00Z"),
  observation: null,
  verified_by: null,
  verified_initials: null,
  verified_at: null,
  note: null,
};

test("a trip with no realtime evidence reads as unknown, never on time", () => {
  const shaped = shapeTrip(base);
  assert.equal(shaped.start_status, "unknown");
  assert.equal(shaped.actual_start_at, null);
  assert.equal(shaped.verification, null);
  assert.equal(shaped.scheduled_start_at, "2026-09-08T08:20:00.000Z");
});

test("carries the human observation as its own object when one exists", () => {
  const shaped = shapeTrip({
    ...base,
    observation: "observed_left_late",
    verified_by: "ocs@example.org",
    verified_initials: "JD",
    verified_at: new Date("2026-09-08T08:24:00Z"),
    note: null,
  });
  assert.deepEqual(shaped.verification, {
    observation: "observed_left_late",
    verified_by: "ocs@example.org",
    verified_initials: "JD",
    verified_at: "2026-09-08T08:24:00.000Z",
    note: null,
  });
});

test("the same staff roles that read Fixed Route Departures read the log", () => {
  assert.ok(TRIP_START_LOG_READ_ROLES.includes("OCC.Viewer"));
  assert.ok(TRIP_START_LOG_READ_ROLES.includes("OCC.Compliance"));
  assert.ok(TRIP_START_LOG_READ_ROLES.includes("OCC.TripStartVerify"), "the contractor desk must be able to read what it verifies");
  assert.ok(!TRIP_START_LOG_READ_ROLES.includes("System.Ingestion"));
});
