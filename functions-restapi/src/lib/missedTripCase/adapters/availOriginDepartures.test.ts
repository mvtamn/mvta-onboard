import assert from "node:assert/strict";
import test from "node:test";
import { availOriginDepartureObservations, type OriginHourRow } from "./availOriginDepartures";

// Which fixed-route cases Avail OTP Daily speaks about, from the origin-hour
// rows the read returns. decide.test.ts says what the observation does to a case.

function row(overrides: Partial<OriginHourRow> = {}): OriginHourRow {
  return {
    trip_id: "t3ED-b27-sl1C-v65", service_date: "20261104", route_id: "465",
    scheduled_departure_at: new Date("2026-11-04T16:05:00Z"),
    origin_stop_id: "12345", origin_stop_name: "Oak St at 4 St / 5 St SE", local_hour: 10,
    scheduled: 2, departures: 2, missed: 0,
    ...overrides,
  };
}

async function observe(rows: OriginHourRow[]) {
  let asked: number | null = null;
  const result = await availOriginDepartureObservations({ originHours: async (days) => { asked = days; return rows; } });
  return { ...result, asked };
}

test("every scheduled departure seen at the origin hour is a Departure observed at origin", async () => {
  const { observations, tally, asked } = await observe([row()]);
  assert.equal(asked, 95, "the same window Avail can still restate");
  assert.equal(observations.length, 1);
  const [o] = observations;
  assert.deepEqual(o.run, {
    source: "avail", runId: "t3ED-b27-sl1C-v65", serviceDate: "20261104", routeId: "465",
    scheduledStartAt: new Date("2026-11-04T16:05:00Z"), deadlineAt: new Date("2026-11-04T16:05:00Z"),
  });
  assert.deepEqual(o.fact, { kind: "origin_departures_observed", departures: 2, scheduled: 2, originStopName: "Oak St at 4 St / 5 St SE", localHour: 10 });
  assert.deepEqual(o.evidence, {
    source: "avail_otp_daily", calendarDate: "20261104", routeId: "465", originStopId: "12345",
    originStopName: "Oak St at 4 St / 5 St SE", localHour: 10, departures: 2, scheduled: 2, missed: 0,
  });
  assert.deepEqual(tally, { cases: 1, departed: 1, short: 0, noRow: 0 });
});

test("more departures than scheduled still accounts for every trip", async () => {
  const { observations } = await observe([row({ scheduled: 2, departures: 5 })]);
  assert.equal(observations.length, 1);
});

test("a departure Avail called missed in the hour says nothing, however many others left", async () => {
  // OTP Daily counts every departure of the route from the stop, including
  // trips that only pass through it, so the count alone can exceed the trips
  // that start there while one of them did not leave.
  const { observations, tally } = await observe([row({ scheduled: 2, departures: 5, missed: 1 })]);
  assert.deepEqual(observations, []);
  assert.deepEqual(tally, { cases: 1, departed: 0, short: 1, noRow: 0 });
});

test("a shortfall, or an origin hour Avail never detects, says nothing", async () => {
  // Burnsville Center: Avail records no departure there at all, so its silence
  // is not evidence either way.
  const { observations, tally } = await observe([
    row({ trip_id: "short", scheduled: 2, departures: 1 }),
    row({ trip_id: "blind", origin_stop_name: "Burnsville Center", departures: null, missed: null }),
  ]);
  assert.deepEqual(observations, []);
  assert.deepEqual(tally, { cases: 2, departed: 0, short: 1, noRow: 1 });
});

test("an origin with no name is named by its stop id", async () => {
  const { observations } = await observe([row({ origin_stop_name: null })]);
  const fact = observations[0].fact;
  assert.ok(fact.kind === "origin_departures_observed" && fact.originStopName === "stop 12345");
});
