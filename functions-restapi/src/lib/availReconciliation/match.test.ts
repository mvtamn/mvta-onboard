import assert from "node:assert/strict";
import test from "node:test";
import { matchIncident } from "./match";
import type { AvailIncident, CaseCandidate } from "./types";

const START = new Date("2026-09-17T14:00:00Z");

const incident = (overrides: Partial<AvailIncident> = {}): AvailIncident => ({
  calendar_date: "20260917",
  route_id: 460,
  departure_stop_id: 1201,
  departure_trip_start_time: START,
  departure_missed: true,
  arrival_missed: false,
  entire_trip_missed: true,
  ...overrides,
});

const theCase = (overrides: Partial<CaseCandidate> = {}): CaseCandidate => ({
  trip_id: "T1",
  service_date: "20260917",
  route_id: "460",
  scheduled_departure_at: START,
  first_stop_id: "1201",
  ...overrides,
});

test("everything agreeing is an exact match", () => {
  const match = matchIncident(incident(), [theCase()]);
  assert.equal(match.confidence, "exact");
  assert.equal(match.trip_id, "T1");
  assert.equal(match.finding, "missed_trip");
});

test("a partial failure is recorded as what it is", () => {
  assert.equal(matchIncident(incident({ entire_trip_missed: false }), [theCase()]).finding, "partial_service");
});

test("a start time to the minute is what matches, not to the second", () => {
  const off = new Date(START.getTime() + 30_000);
  assert.equal(matchIncident(incident({ departure_trip_start_time: off }), [theCase()]).confidence, "exact");
  const later = new Date(START.getTime() + 60_000);
  assert.equal(matchIncident(incident({ departure_trip_start_time: later }), [theCase()]).confidence, "unmatched");
});

test("a departure stop that is not the trip's first stop is probable, never exact", () => {
  const match = matchIncident(incident({ departure_stop_id: 1399 }), [theCase()]);
  assert.equal(match.confidence, "probable");
  assert.equal(match.trip_id, "T1");
  assert.match(match.reason, /1399/);
});

test("a schedule that no longer holds the trip downgrades rather than fails", () => {
  const match = matchIncident(incident(), [theCase({ first_stop_id: null })]);
  assert.equal(match.confidence, "probable");
  assert.match(match.reason, /no longer holds/);
});

test("no stop reported is probable on time alone", () => {
  assert.equal(matchIncident(incident({ departure_stop_id: null }), [theCase()]).confidence, "probable");
});

test("no start time reported leans on route and day, and only when one case fits", () => {
  const blind = incident({ departure_trip_start_time: null });
  assert.equal(matchIncident(blind, [theCase()]).confidence, "probable");
  const two = matchIncident(blind, [theCase(), theCase({ trip_id: "T2" })]);
  assert.equal(two.confidence, "unmatched");
  assert.match(two.reason, /2 cases/);
});

test("two cases sharing a route, day and start time cannot be told apart", () => {
  const match = matchIncident(incident(), [theCase(), theCase({ trip_id: "T2" })]);
  assert.equal(match.confidence, "unmatched");
  assert.equal(match.trip_id, null);
  assert.match(match.reason, /share that route, service date and start time/);
});

test("an incident with no case behind it is recorded as unmatched, not dropped", () => {
  const none = matchIncident(incident(), []);
  assert.equal(none.confidence, "unmatched");
  assert.match(none.reason, /No Missed-trip case/);
  assert.equal(matchIncident(incident({ route_id: 999 }), [theCase()]).confidence, "unmatched");
  assert.equal(matchIncident(incident({ calendar_date: "20260916" }), [theCase()]).confidence, "unmatched");
});

test("a service date key longer than eight characters still matches its day", () => {
  assert.equal(matchIncident(incident(), [theCase({ service_date: "20260917" })]).confidence, "exact");
});
