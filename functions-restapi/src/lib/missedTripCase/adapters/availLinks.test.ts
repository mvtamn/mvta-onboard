import assert from "node:assert/strict";
import test from "node:test";
import { linkFor, linksFrom, matchReason } from "./availLinks";
import type { AvailMatch, AvailMissedTripRow, MatchableCase } from "./avail";

const START = new Date("2026-09-17T14:00:00Z");

const row = (overrides: Partial<AvailMissedTripRow> = {}): AvailMissedTripRow => ({
  calendar_date: "20260917",
  route_id: 460,
  departure_stop_name: "Burnsville Station",
  arrival_stop_name: "Mall of America",
  departure_missed: false,
  arrival_missed: false,
  entire_trip_missed: true,
  departure_trip_start_time: START,
  ...overrides,
});

const matched: MatchableCase = {
  trip_id: "T1", service_date: "20260917", route_id: "460", scheduled_departure_at: START,
};

const match = (overrides: Partial<AvailMatch> = {}): AvailMatch => ({
  confidence: "exact", matched, candidates: 1, ...overrides,
});

test("an exact link names its case", () => {
  const link = linkFor(row(), match());
  assert.equal(link.trip_id, "T1");
  assert.equal(link.match_confidence, "exact");
  assert.match(link.match_reason, /exactly one case/);
});

test("a probable link says what a reviewer has to settle", () => {
  const ambiguous = matchReason(row(), match({ confidence: "probable", matched: null, candidates: 3 }));
  assert.match(ambiguous, /3 cases share that route, service date and start time/);
  const timeless = matchReason(
    row({ departure_trip_start_time: null }),
    match({ confidence: "probable", matched: null, candidates: 2 }),
  );
  assert.match(timeless, /no start time/);
  assert.match(timeless, /2 case/);
});

test("an unmatched link says whether anything ran on that route at all", () => {
  assert.match(matchReason(row(), match({ confidence: "unmatched", matched: null, candidates: 0 })),
    /No missed-trip case on that route/);
  assert.match(matchReason(row(), match({ confidence: "unmatched", matched: null, candidates: 4 })),
    /none starting at the time Avail reported/);
});

test("a probable link names no case, so a reviewer has to", () => {
  const link = linkFor(row(), match({ confidence: "probable", matched: null, candidates: 2 }));
  assert.equal(link.trip_id, null);
  assert.equal(link.service_date, null);
  assert.equal(link.candidate_count, 2);
});

test("a link keeps what Avail said, so a confirmation can act on it later", () => {
  const link = linkFor(row({ entire_trip_missed: false, departure_missed: true }), match());
  assert.equal(link.departure_missed, true);
  assert.equal(link.entire_trip_missed, false);
  assert.equal(link.departure_stop_name, "Burnsville Station");
});

test("every record in a run becomes a link, placed or not", () => {
  const links = linksFrom([
    { row: row(), match: match() },
    { row: row({ route_id: 999 }), match: match({ confidence: "unmatched", matched: null, candidates: 0 }) },
  ]);
  assert.deepEqual(links.map((l) => l.match_confidence), ["exact", "unmatched"]);
});
