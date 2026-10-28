// What a GTFS case's evidence block says, built from the raw readings. The
// shapes come from dev on 2026-10-21 (query 8 of missed-trip-feed-comparison):
// a bus that left 19 minutes late, a schedule repeated for a block nobody
// drove, and a stop where nearly every earlier no-show turned out to have run.
import assert from "node:assert/strict";
import { test } from "node:test";
import { caseEvidence, DEAD_ZONE_MIN_CASES, type CaseEvidenceRow } from "./caseEvidence";

const SCHEDULED = new Date("2026-10-16T22:30:00.000Z");
const DEADLINE = new Date("2026-10-16T23:00:00.000Z");

function row(overrides: Partial<CaseEvidenceRow> = {}): CaseEvidenceRow {
  return {
    trip_id: "t6C2-b14C-sl2B-v64",
    service_date: "20261016",
    scheduled_departure_at: SCHEDULED,
    grace_deadline_at: DEADLINE,
    dispatch_start_at: new Date("2026-10-16T22:49:42.000Z"),
    dispatch_start_source: "trip_update",
    dispatch_predicted_at: new Date("2026-10-16T22:43:00.000Z"),
    dispatch_scheduled_at: SCHEDULED,
    first_vehicle_position_at: new Date("2026-10-16T22:59:45.000Z"),
    first_underway_at: new Date("2026-10-16T22:59:45.000Z"),
    vehicle_id: "4265",
    block_id: "b14C",
    block_trips: 9,
    block_trips_reported: 8,
    origin_stop_id: "51990",
    origin_stop_name: "Savage Park & Ride",
    origin_cases: 27,
    origin_cases_ran: 27,
    counted_in_origin: true,
    ...overrides,
  };
}

test("a bus that left inside the grace: when, how late, and that it was inside", () => {
  const evidence = caseEvidence(row());
  assert.deepEqual(evidence.departure, { reading: "departed", at: "2026-10-16T22:49:42.000Z" });
  assert.equal(evidence.started_at, "2026-10-16T22:49:42.000Z");
  assert.equal(evidence.started_late_minutes, 19);
  assert.equal(evidence.started_inside_grace, true);
});

test("the start is the position proof when no departure is usable", () => {
  const evidence = caseEvidence(row({ dispatch_start_at: SCHEDULED, first_underway_at: new Date("2026-10-16T23:09:30.000Z") }));
  assert.equal(evidence.departure.reading, "schedule_repeated");
  assert.equal(evidence.started_at, "2026-10-16T23:09:30.000Z");
  assert.equal(evidence.started_late_minutes, 39);
  assert.equal(evidence.started_inside_grace, false);
});

test("no start at all says so, and how late is unknown rather than zero", () => {
  const evidence = caseEvidence(row({
    dispatch_start_at: null, dispatch_start_source: null, first_underway_at: null, first_vehicle_position_at: null, vehicle_id: null,
  }));
  assert.deepEqual(evidence.departure, { reading: "not_recorded", at: null });
  assert.equal(evidence.started_at, null);
  assert.equal(evidence.started_late_minutes, null);
  assert.equal(evidence.started_inside_grace, null);
  assert.deepEqual(evidence.vehicle, { reported_at: null, underway_at: null, vehicle_id: null });
});

test("a departure no bus reported against is named, not used", () => {
  const evidence = caseEvidence(row({ first_vehicle_position_at: null, first_underway_at: null }));
  assert.equal(evidence.departure.reading, "no_vehicle");
  assert.equal(evidence.started_at, null);
});

test("an early departure reads as negative minutes, not as late", () => {
  const evidence = caseEvidence(row({ dispatch_start_at: new Date("2026-10-16T22:15:08.000Z") }));
  assert.equal(evidence.started_late_minutes, -14);
  assert.equal(evidence.started_inside_grace, true);
});

test("the block counts its trips and the ones a bus reported on", () => {
  assert.deepEqual(caseEvidence(row()).block, { block_id: "b14C", trips: 9, trips_reported: 8 });
  assert.deepEqual(caseEvidence(row({ block_trips_reported: 0 })).block, { block_id: "b14C", trips: 9, trips_reported: 0 });
});

test("a trip with no block in the Dispatch Log carries no block", () => {
  assert.equal(caseEvidence(row({ block_id: null, block_trips: null, block_trips_reported: null })).block, null);
});

test("a stop where most earlier no-shows ran is a likely dead zone", () => {
  assert.deepEqual(caseEvidence(row()).origin_stop, {
    stop_id: "51990", name: "Savage Park & Ride", other_cases: 26, other_cases_ran: 26, likely_dead_zone: true,
  });
});

test("a stop with too few earlier cases is not called a dead zone, however they went", () => {
  const evidence = caseEvidence(row({ origin_cases: DEAD_ZONE_MIN_CASES, origin_cases_ran: DEAD_ZONE_MIN_CASES }));
  assert.equal(evidence.origin_stop?.likely_dead_zone, false);
});

test("a stop where most earlier no-shows did not run is not a dead zone", () => {
  assert.equal(caseEvidence(row({ origin_cases: 11, origin_cases_ran: 6 })).origin_stop?.likely_dead_zone, false);
});

test("the stop's history leaves this case out, so a stop's first case has none", () => {
  // The read counts every silent no-show at the stop, this one included; a
  // case is not evidence about itself, so it is taken off with whether it ran.
  const ran = caseEvidence(row({ origin_cases: 1, origin_cases_ran: 1 }));
  assert.equal(ran.origin_stop?.other_cases, 0);
  assert.equal(ran.origin_stop?.other_cases_ran, 0);
  const notRan = caseEvidence(row({
    dispatch_start_at: null, first_underway_at: null, origin_cases: 4, origin_cases_ran: 3,
  }));
  assert.equal(notRan.origin_stop?.other_cases, 3);
  assert.equal(notRan.origin_stop?.other_cases_ran, 3);
});

test("a trip with no origin stop in the Dispatch Log carries none", () => {
  assert.equal(caseEvidence(row({ origin_stop_id: null, origin_stop_name: null, origin_cases: null, origin_cases_ran: null })).origin_stop, null);
});

test("a case the stop's record leaves out is not taken off it", () => {
  // A retired or data-gap case is not in origin_cases, so subtracting it
  // would undercount the stop by one.
  const evidence = caseEvidence(row({ counted_in_origin: false, origin_cases: 26, origin_cases_ran: 26 }));
  assert.equal(evidence.origin_stop?.other_cases, 26);
  assert.equal(evidence.origin_stop?.other_cases_ran, 26);
  assert.equal(evidence.origin_stop?.likely_dead_zone, true);
});
