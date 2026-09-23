// The GTFS detection rules, over a Scheduled day built in memory. What is
// exercised here is everything that decides WHICH trips reach
// missedTripConfidence.ts - the deadline filter, the start-evidence check, the
// special-event exclusion, the agreement denominator and the day rollover -
// which missedTripConfidence.test.ts cannot see, because by the time it runs
// the trip has already been selected.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cancellationObservations,
  datedCancellations,
  dayEvidence,
  emptyTally,
  gtfsObservations,
  silentNoShowObservations,
  tripStartObservations,
  type DetectionConfidence,
  type GtfsDetectionDeps,
  type ScheduledDay,
  type ScheduledRun,
  type TripStartEvidence,
} from "./gtfs";
import { missedTripDetectionSettings } from "../settings";
import { SCHEDULE_RELATIONSHIP_CANCELED, type GtfsRtTripUpdateEntity } from "../../gtfsTripUpdates";

const SERVICE_DATE = "20260917";
// 14:00:00 agency-local (CDT) on that service date.
const DEPARTURE_SECONDS = 14 * 3600;
const SCHEDULED_AT = new Date("2026-09-17T19:00:00.000Z");
const DEADLINE_AT = new Date("2026-09-17T19:30:00.000Z");
const PAST_DEADLINE = new Date("2026-09-17T19:45:00.000Z");
const BEFORE_DEADLINE = new Date("2026-09-17T19:15:00.000Z");

function run(overrides: Partial<ScheduledRun> = {}): ScheduledRun {
  return {
    trip_id: "T1",
    route_id: "460",
    block_id: null,
    first_departure_seconds: DEPARTURE_SECONDS,
    last_arrival_seconds: null,
    first_underway_at: null,
    first_vehicle_position_at: null,
    first_trip_update_at: null,
    special_event: false,
    ...overrides,
  };
}

function day(runs: ScheduledRun[], serviceDate = SERVICE_DATE): ScheduledDay {
  return { serviceDate, runs };
}

const trusted = { trusted: true, explanation: null };

function confidence(overrides: Partial<DetectionConfidence> = {}): DetectionConfidence {
  return { coverageProven: true, coverageReason: "", staticSchedule: trusted, ...overrides };
}

function observe(runs: ScheduledRun[], now = PAST_DEADLINE, conf = confidence()) {
  const tally = emptyTally();
  const observations = silentNoShowObservations(day(runs), conf, now, tally);
  return { observations, tally };
}

// --- the deadline filter -----------------------------------------------------

test("a trip whose deadline has not passed is not observed", () => {
  assert.deepEqual(observe([run()], BEFORE_DEADLINE).observations, []);
});

test("a trip is past its deadline the instant the deadline arrives", () => {
  const { observations } = observe([run()], DEADLINE_AT);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].fact.kind, "no_start_by_deadline");
  assert.deepEqual(observations[0].run.scheduledStartAt, SCHEDULED_AT);
  assert.deepEqual(observations[0].run.deadlineAt, DEADLINE_AT);
});

test("start evidence at the deadline is Timely service, so the trip is not observed", () => {
  assert.deepEqual(observe([run({ first_underway_at: DEADLINE_AT })]).observations, []);
});

test("start evidence after the deadline still leaves the trip observed", () => {
  const late = new Date(DEADLINE_AT.getTime() + 1000);
  const { observations } = observe([run({ first_underway_at: late })]);
  assert.equal(observations.length, 1);
});

// --- exclusions --------------------------------------------------------------

test("a special-event trip is never observed", () => {
  assert.deepEqual(observe([run({ special_event: true })]).observations, []);
});

test("a special-event trip still counts in the day's agreement denominator", () => {
  // 20 past-deadline trips is the minimum sample; with 19 ordinary trips the
  // agreement test would not apply at all. The special-event trip is the 20th.
  const runs = [
    ...Array.from({ length: 19 }, (_, i) => run({ trip_id: `T${i}`, block_id: null })),
    run({ trip_id: "SPECIAL", special_event: true }),
  ];
  const { agreement } = dayEvidence(day(runs), PAST_DEADLINE);
  // None of the 20 appeared in any feed, so agreement fails - which it could
  // not do if the special-event trip had been filtered out first.
  assert.equal(agreement.trusted, false);
  assert.match(agreement.explanation ?? "", /0 of 20/);
});

test("a trip whose deadline has not passed is left out of the denominator", () => {
  const runs = Array.from({ length: 25 }, (_, i) => run({ trip_id: `T${i}` }));
  const { agreement } = dayEvidence(day(runs), BEFORE_DEADLINE);
  assert.equal(agreement.trusted, true, "no trip is past its deadline, so there is nothing to measure");
});

test("the block map is built from every run that carries a block", () => {
  const { blocks } = dayEvidence(day([
    run({ trip_id: "A", block_id: "B1", first_vehicle_position_at: PAST_DEADLINE }),
    run({ trip_id: "B", block_id: "B1", first_departure_seconds: DEPARTURE_SECONDS - 3600, first_underway_at: PAST_DEADLINE }),
    run({ trip_id: "C", block_id: null }),
  ]), PAST_DEADLINE);
  assert.deepEqual([...blocks.keys()], ["B1"]);
  assert.equal(blocks.get("B1")?.length, 2);
});

// --- what an observation carries ---------------------------------------------

test("the Expected operating window is the scheduled final stop plus 30 minutes", () => {
  const { observations } = observe([run({ last_arrival_seconds: 15 * 3600 })]);
  assert.deepEqual(observations[0].run.operatingWindowEndAt, new Date("2026-09-17T20:30:00.000Z"));
});

test("a trip with no scheduled final stop carries no operating window", () => {
  assert.equal(observe([run()]).observations[0].run.operatingWindowEndAt, null);
});

test("an undecidable trip carries its reason, and the day says why", () => {
  const { observations, tally } = observe([run()], PAST_DEADLINE, confidence({
    coverageProven: false,
    coverageReason: "gtfs_vehicle_positions is stale",
  }));
  assert.deepEqual(observations[0].fact, { kind: "undecidable", reason: "vehicle_position_feed_not_current" });
  assert.equal(tally.undecidable, 1);
  assert.equal(tally.noShows, 0);
  assert.equal(tally.undecidedBy.get("vehicle_position_feed_not_current"), 1);
  assert.match(tally.warnings[0], /Position coverage: gtfs_vehicle_positions is stale/);
});

test("a day that decided everything adds no warning", () => {
  assert.deepEqual(observe([run()]).tally.warnings, []);
});

test("an empty Scheduled day observes nothing", () => {
  assert.deepEqual(observe([]).observations, []);
});

// --- cancellations -----------------------------------------------------------

function cancelEntity(tripId: string, serviceDate: string | null): GtfsRtTripUpdateEntity {
  return {
    Id: tripId,
    TripUpdate: {
      Trip: {
        TripId: tripId,
        RouteId: "460",
        StartDate: serviceDate ?? "",
        schedule_relationship: SCHEDULE_RELATIONSHIP_CANCELED,
      },
      Vehicle: null,
      StopTimeUpdates: null,
      Timestamp: 0,
    },
    Vehicle: null,
    Alert: null,
  };
}

test("a cancelled trip with no service date is counted but not recorded", () => {
  const tally = emptyTally();
  const dated = datedCancellations([cancelEntity("T1", null), cancelEntity("T2", SERVICE_DATE)], tally);
  assert.equal(tally.undatedCancellations, 1);
  assert.deepEqual(dated.map((t) => t.trip_id), ["T2"]);
});

test("a cancellation resolves its scheduled start from the departure seconds", () => {
  const tally = emptyTally();
  const dated = datedCancellations([cancelEntity("T1", SERVICE_DATE)], tally);
  const [observation] = cancellationObservations(dated, new Map([["T1", DEPARTURE_SECONDS]]), PAST_DEADLINE, tally);
  assert.deepEqual(observation.run.scheduledStartAt, SCHEDULED_AT);
  assert.deepEqual(observation.run.deadlineAt, DEADLINE_AT);
  assert.equal(tally.cancellations, 1);
});

test("a cancellation with no known schedule falls back to the detection time", () => {
  const tally = emptyTally();
  const dated = datedCancellations([cancelEntity("T1", SERVICE_DATE)], tally);
  const [observation] = cancellationObservations(dated, new Map(), PAST_DEADLINE, tally);
  assert.deepEqual(observation.run.scheduledStartAt, PAST_DEADLINE);
  assert.deepEqual(observation.run.deadlineAt, PAST_DEADLINE);
});

// --- trip starts -------------------------------------------------------------

test("start evidence for a trip with no known route carries an empty route", () => {
  const tally = emptyTally();
  const rows: TripStartEvidence[] = [
    { trip_id: "T1", service_date: SERVICE_DATE, first_underway_at: PAST_DEADLINE, route_id: null, first_departure_seconds: null },
  ];
  const [observation] = tripStartObservations(rows, tally);
  assert.equal(observation.run.routeId, "");
  assert.deepEqual(observation.run.scheduledStartAt, PAST_DEADLINE);
  assert.deepEqual(observation.fact, { kind: "trip_start", at: PAST_DEADLINE });
  assert.equal(tally.tripStarts, 1);
});

// --- the pass: rollover, the paused detector, failing closed -----------------

const silence = { log: () => {}, warn: () => {}, error: () => {} };

// Captures what the pass logged, so a failure that is swallowed on purpose
// still has to say which day or which read it was.
function capture() {
  const errors: string[] = [];
  return { errors, log: { log: () => {}, warn: () => {}, error: (...args: unknown[]) => { errors.push(args.map(String).join(" ")); } } };
}

function deps(overrides: Partial<GtfsDetectionDeps> = {}): GtfsDetectionDeps {
  return {
    scheduledDay: async ({ serviceDate }) => day([], serviceDate),
    tripStarts: async () => [],
    departureSecondsFor: async () => new Map(),
    feedHealth: async () => [],
    ...overrides,
  };
}

const ON = missedTripDetectionSettings({ GTFS_SILENT_NO_SHOW_ENABLED: "true" });
const PAUSED = missedTripDetectionSettings({});

test("a pass detects over today and yesterday", async () => {
  const asked: string[] = [];
  await gtfsObservations([], silence, ON, deps({
    scheduledDay: async ({ serviceDate }) => {
      asked.push(serviceDate);
      return day([], serviceDate);
    },
  }), PAST_DEADLINE);
  assert.deepEqual(asked, ["20260917", "20260916"]);
});

test("a day that fails to read does not stop the other day, and says which", async () => {
  const asked: string[] = [];
  const logged = capture();
  const { observations } = await gtfsObservations([], logged.log, ON, deps({
    scheduledDay: async ({ serviceDate }) => {
      asked.push(serviceDate);
      if (serviceDate === "20260917") throw new Error("read failed");
      return day([run({ trip_id: "YESTERDAY" })], serviceDate);
    },
  }), PAST_DEADLINE);
  assert.deepEqual(asked, ["20260917", "20260916"]);
  assert.equal(observations.length, 1, "yesterday was still detected");
  assert.equal(observations[0].run.runId, "YESTERDAY");
  assert.equal(logged.errors.length, 1);
  assert.match(logged.errors[0], /20260917.*read failed/);
});

test("with the detector paused no schedule is read, and start evidence still is", async () => {
  let scheduleReads = 0;
  let startReads = 0;
  const { observations } = await gtfsObservations([], silence, PAUSED, deps({
    scheduledDay: async ({ serviceDate }) => {
      scheduleReads++;
      return day([], serviceDate);
    },
    tripStarts: async (dates) => {
      startReads++;
      assert.deepEqual(dates, ["20260917", "20260916"]);
      return [];
    },
  }), PAST_DEADLINE);
  assert.equal(scheduleReads, 0);
  assert.equal(startReads, 1);
  assert.deepEqual(observations, []);
});

test("feed health that cannot be read fails closed, and says so", async () => {
  const logged = capture();
  const { observations } = await gtfsObservations([], logged.log, ON, deps({
    feedHealth: async () => { throw new Error("ledger unreadable"); },
    scheduledDay: async ({ serviceDate }) => day(serviceDate === "20260917" ? [run()] : [], serviceDate),
  }), PAST_DEADLINE);
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0].fact, { kind: "undecidable", reason: "vehicle_position_feed_not_current" });
  assert.match(logged.errors[0], /Failed to resolve feed confidence.*ledger unreadable/);
});

test("a cancellation is looked up only when the feed carries one", async () => {
  let lookups = 0;
  await gtfsObservations([], silence, PAUSED, deps({
    departureSecondsFor: async () => { lookups++; return new Map(); },
  }), PAST_DEADLINE);
  assert.equal(lookups, 0);

  await gtfsObservations([cancelEntity("T1", SERVICE_DATE)], silence, PAUSED, deps({
    departureSecondsFor: async (tripIds) => {
      lookups++;
      assert.deepEqual(tripIds, ["T1"]);
      return new Map();
    },
  }), PAST_DEADLINE);
  assert.equal(lookups, 1);
});
