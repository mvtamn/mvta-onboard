// The Avail matching rule (ADR-0035). Avail names no trip, so everything here
// turns on route + service date + Published Trip start, and on refusing to
// guess when that is not enough.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availObservation,
  availObservations,
  matchAvailReport,
  type AvailDetectionDeps,
  type AvailMissedTripRow,
  type MatchableCase,
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
  return { reports: async () => reports, casesInWindow: async () => cases };
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
  });
  assert.deepEqual(observations, []);
  assert.equal(tally.reports, 0);
  assert.equal(caseReads, 0);
});

test("the window asked for is the window Avail can still restate", async () => {
  let asked: number | null = null;
  await availObservations({ reports: async (days) => { asked = days; return []; }, casesInWindow: async () => [] }, 95);
  assert.equal(asked, 95);
});
