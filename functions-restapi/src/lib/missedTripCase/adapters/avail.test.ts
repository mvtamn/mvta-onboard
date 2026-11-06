// The Avail matching rule (ADR-0035, amended by ADR-0047). Avail names no trip,
// so everything here turns on route + service date + the minute the bus left,
// and on refusing to guess when that is not enough.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availObservation,
  availObservations,
  matchAvailReport,
  type AvailDetectionDeps,
  type AvailMissedTripRow,
  type MatchableCase,
  type ScheduledTrip,
} from "./avail";

const DAY = "20260917";
const AT_1400 = new Date("2026-09-17T19:00:00.000Z");
const AT_1430 = new Date("2026-09-17T19:30:00.000Z");

function report(overrides: Partial<AvailMissedTripRow> = {}): AvailMissedTripRow {
  return {
    calendar_date: DAY,
    route_id: 460,
    departure_stop_name: "Burnsville Transit Station",
    arrival_stop_name: "Minneapolis",
    departure_missed: false,
    arrival_missed: false,
    entire_trip_missed: true,
    departure_trip_start_time: AT_1400,
    ...overrides,
  };
}

function aCase(overrides: Partial<MatchableCase> = {}): MatchableCase {
  return { trip_id: "T1", service_date: DAY, route_id: "460", scheduled_departure_at: AT_1400, ...overrides };
}

function index(cases: MatchableCase[]): Map<string, MatchableCase[]> {
  const map = new Map<string, MatchableCase[]>();
  for (const c of cases) {
    const key = `${c.service_date}|${c.route_id}`;
    map.set(key, [...(map.get(key) ?? []), c]);
  }
  return map;
}

// --- the match ---------------------------------------------------------------

test("route, date and start time to the minute, naming one case, is an exact link", () => {
  const match = matchAvailReport(report(), index([aCase()]));
  assert.equal(match.confidence, "exact");
  assert.equal(match.matched?.trip_id, "T1");
});

test("the second is noise: two systems formatting the same scheduled minute still match", () => {
  const match = matchAvailReport(
    report({ departure_trip_start_time: new Date("2026-09-17T19:00:41.000Z") }),
    index([aCase()]),
  );
  assert.equal(match.confidence, "exact");
});

test("a different minute on the same route and day is not the same run", () => {
  const match = matchAvailReport(report({ departure_trip_start_time: AT_1430 }), index([aCase()]));
  assert.equal(match.confidence, "unmatched");
  assert.equal(match.candidates, 1, "there was a case on that route and day, just not that run");
});

test("two cases departing the same minute is probable, not a guess", () => {
  const match = matchAvailReport(report(), index([aCase(), aCase({ trip_id: "T2" })]));
  assert.equal(match.confidence, "probable");
  assert.equal(match.matched, null, "a probable link names no case");
  assert.equal(match.candidates, 2);
});

test("no start time is probable even when exactly one case could be meant", () => {
  // Route and date alone tie nothing to anything; one candidate is a
  // coincidence of a quiet day, not evidence.
  const match = matchAvailReport(report({ departure_trip_start_time: null }), index([aCase()]));
  assert.equal(match.confidence, "probable");
  assert.equal(match.matched, null);
});

test("a run no case ever noticed is unmatched", () => {
  assert.equal(matchAvailReport(report(), index([])).confidence, "unmatched");
  assert.equal(matchAvailReport(report({ route_id: 999 }), index([aCase()])).confidence, "unmatched");
  assert.equal(matchAvailReport(report({ calendar_date: "20260916" }), index([aCase()])).confidence, "unmatched");
});

// --- the departure, not the schedule -------------------------------------------
//
// Avail's DepartureTripStartTime is the time the bus actually left, cut to the
// minute - measured on dev 2026-11-06, 90% of the records 1-5 minutes off a
// scheduled start sat within a minute of the Dispatch Log's actual start. So a
// record is first resolved to the one trip that left that minute, among every
// trip on the route that day, and only then looked for among the cases.

function aTrip(overrides: Partial<ScheduledTrip> = {}): ScheduledTrip {
  return { trip_id: "T1", service_date: DAY, route_id: "460", scheduled_start_at: AT_1400, actual_start_at: null, ...overrides };
}

function trips(list: ScheduledTrip[]): Map<string, ScheduledTrip[]> {
  const map = new Map<string, ScheduledTrip[]>();
  for (const t of list) {
    const key = `${t.service_date}|${t.route_id}`;
    map.set(key, [...(map.get(key) ?? []), t]);
  }
  return map;
}

const at = (hhmmss: string) => new Date(`2026-09-17T${hhmmss}.000Z`);

test("a trip that left three minutes late is found by its departure", () => {
  const match = matchAvailReport(
    report({ entire_trip_missed: false, arrival_missed: true, departure_trip_start_time: at("19:03:00") }),
    index([aCase()]),
    trips([aTrip({ actual_start_at: at("19:03:20") })]),
  );
  assert.equal(match.confidence, "exact");
  assert.equal(match.matched?.trip_id, "T1");
  assert.equal(match.trip_id, "T1");
});

test("a departure names the trip that left, not a case merely scheduled that minute", () => {
  // T1's case is scheduled 14:00 but its bus left at 14:06; T2 left at 14:00.
  // Matching on the schedule alone gave T2's record to T1's case.
  const match = matchAvailReport(
    report({ entire_trip_missed: false, arrival_missed: true, departure_trip_start_time: AT_1400 }),
    index([aCase()]),
    trips([
      aTrip({ actual_start_at: at("19:06:10") }),
      aTrip({ trip_id: "T2", scheduled_start_at: at("18:58:00"), actual_start_at: at("19:00:15") }),
    ]),
  );
  assert.equal(match.confidence, "unmatched");
  assert.equal(match.matched, null);
  assert.equal(match.trip_id, "T2", "the record is about the trip that left, which has no case");
});

test("a trip the Dispatch Log has no departure for is found by its schedule", () => {
  const match = matchAvailReport(report(), index([aCase()]), trips([aTrip()]));
  assert.equal(match.confidence, "exact");
  assert.equal(match.matched?.trip_id, "T1");
});

test("a reading a day away from its schedule is not a departure", () => {
  // Dev's Dispatch Log stored 2026-09-09 with every reading 24 hours late.
  const match = matchAvailReport(
    report({ entire_trip_missed: false, arrival_missed: true }),
    index([aCase()]),
    trips([aTrip({ actual_start_at: new Date("2026-09-18T19:00:20.000Z") })]),
  );
  assert.equal(match.confidence, "exact", "the trip falls back to its schedule");
  assert.equal(match.trip_id, "T1");
});

test("two trips leaving the same minute is probable, not a guess", () => {
  const match = matchAvailReport(
    report(),
    index([aCase()]),
    trips([aTrip(), aTrip({ trip_id: "T2", scheduled_start_at: at("18:55:00"), actual_start_at: at("19:00:05") })]),
  );
  assert.equal(match.confidence, "probable");
  assert.equal(match.matched, null);
  assert.equal(match.candidates, 2);
  assert.equal(match.trip_id, null);
});

test("a departure no trip on that route made that minute is unmatched", () => {
  const match = matchAvailReport(report({ departure_trip_start_time: AT_1430 }), index([aCase()]), trips([aTrip()]));
  assert.equal(match.confidence, "unmatched");
  assert.equal(match.trip_id, null);
});

test("a route-day the Dispatch Log does not cover keeps the scheduled-minute rule", () => {
  // The log starts 2026-08-31; Avail restates three months.
  const match = matchAvailReport(report(), index([aCase()]), trips([aTrip({ route_id: "999" })]));
  assert.equal(match.confidence, "exact");
  assert.equal(match.trip_id, undefined, "resolved against cases, not trips");
});

test("no start time is still probable when the trips are known", () => {
  const match = matchAvailReport(report({ departure_trip_start_time: null }), index([aCase()]), trips([aTrip()]));
  assert.equal(match.confidence, "probable");
});

// --- what Avail is saying ----------------------------------------------------

test("a trip missed in whole corroborates a missed trip", () => {
  const observation = availObservation(report(), aCase());
  assert.deepEqual(observation?.fact, { kind: "retrospective_missed" });
  assert.equal(observation?.run.source, "avail");
  assert.equal(observation?.run.runId, "T1", "the observation is about the matched case, not the Avail row");
});

test("a trip that ran while missing a stop is a Partial-service failure", () => {
  const observation = availObservation(
    report({ entire_trip_missed: false, departure_missed: true }),
    aCase(),
  );
  assert.deepEqual(observation?.fact, { kind: "retrospective_partial", missedDeparture: true, missedArrival: false });
});

test("whole-trip wins over the stop flags when Avail sets both", () => {
  const observation = availObservation(report({ entire_trip_missed: true, arrival_missed: true }), aCase());
  assert.equal(observation?.fact.kind, "retrospective_missed");
});

test("a record reporting nothing missed says nothing about the case", () => {
  assert.equal(availObservation(report({ entire_trip_missed: false }), aCase()), null);
});

test("the evidence kept with the case names the stops and the match", () => {
  const evidence = availObservation(report(), aCase())?.evidence as Record<string, unknown>;
  assert.equal(evidence.source, "avail");
  assert.equal(evidence.matchConfidence, "exact");
  assert.equal(evidence.departureStopName, "Burnsville Transit Station");
  assert.equal(evidence.entireTripMissed, true);
});

// --- the pass ----------------------------------------------------------------

function deps(reports: AvailMissedTripRow[], cases: MatchableCase[]): AvailDetectionDeps {
  return { reports: async () => reports, casesInWindow: async () => cases, tripsInWindow: async () => [] };
}

test("only exact links become observations; the rest are counted", async () => {
  const { observations, tally } = await availObservations(deps(
    [
      report(),                                                   // exact
      report({ departure_trip_start_time: null }),                // probable
      report({ route_id: 999 }),                                  // unmatched
    ],
    [aCase()],
  ));
  assert.equal(observations.length, 1);
  assert.deepEqual(
    { reports: tally.reports, exact: tally.exact, probable: tally.probable, unmatched: tally.unmatched },
    { reports: 3, exact: 1, probable: 1, unmatched: 1 },
  );
});

test("a run nothing else noticed is counted, not invented", async () => {
  // Avail cannot open a case, so an unmatched report is the measure of the gap.
  const { observations, tally } = await availObservations(deps([report()], []));
  assert.deepEqual(observations, []);
  assert.equal(tally.unmatched, 1);
});

test("no reports means no case is read at all", async () => {
  let caseReads = 0;
  const { observations, tally } = await availObservations({
    reports: async () => [],
    casesInWindow: async () => { caseReads++; return []; },
    tripsInWindow: async () => { caseReads++; return []; },
  });
  assert.deepEqual(observations, []);
  assert.equal(tally.reports, 0);
  assert.equal(caseReads, 0);
});

test("the window asked for is the window Avail can still restate", async () => {
  let asked: number | null = null;
  await availObservations({ reports: async (days) => { asked = days; return []; }, casesInWindow: async () => [], tripsInWindow: async () => [] }, 95);
  assert.equal(asked, 95);
});

test("the pass resolves departures against the day's trips", async () => {
  const { observations, tally } = await availObservations({
    reports: async () => [report({ entire_trip_missed: false, arrival_missed: true, departure_trip_start_time: at("19:03:00") })],
    casesInWindow: async () => [aCase()],
    tripsInWindow: async () => [aTrip({ actual_start_at: at("19:03:40") })],
  });
  assert.equal(tally.exact, 1);
  assert.equal(observations[0]?.run.runId, "T1");
});
