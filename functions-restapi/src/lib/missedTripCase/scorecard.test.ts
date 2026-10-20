import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScorecard,
  periodsOf,
  scorecardQuery,
  weekBar,
  weekStartOf,
  type CaseDayRow,
  type ScorecardQuery,
} from "./scorecard";

// Tuesday 20 October 2026; the week of 12 October is the last complete one.
const TODAY = "20261020";
const WEEK: ScorecardQuery = { from: "20261012", to: "20261018", grouping: "week" };

const day = (overrides: Partial<CaseDayRow> = {}): CaseDayRow => ({
  service_date: "20261014", detector: "gtfs_silent_no_show",
  legacy: 0, open: 0, closed_by_evidence: 0, held: 0, awaiting_review: 0, reviewed: 0,
  confirmed: 0, timely_service: 0, partial_service_failure: 0, indeterminate: 0, evidence_conflicts: 0,
  avail_corroborated: 0, avail_partial: 0, confirmed_without_avail: 0,
  dispatcher_not_observed: 0, dispatcher_on_time: 0, dispatcher_left_late: 0, review_minutes: 0,
  ...overrides,
});

const silent = (scorecard: ReturnType<typeof buildScorecard>, period = 0) =>
  scorecard.periods[period].detectors.find((d) => d.detector === "gtfs_silent_no_show")!;

test("service weeks run Monday to Sunday", () => {
  assert.equal(weekStartOf("20261020"), "20261019");
  assert.equal(weekStartOf("20261019"), "20261019");
  assert.equal(weekStartOf("20261018"), "20261012", "a Sunday ends the week before");
});

test("a week range is widened to whole weeks, and defaults to the last eight", () => {
  assert.deepEqual(scorecardQuery({ from: "20261014", to: "20261015" }, TODAY),
    { from: "20261012", to: "20261018", grouping: "week" });
  const fallback = scorecardQuery({ from: "not-a-date", to: "20261399" }, TODAY);
  assert.equal(fallback.to, "20261025");
  assert.equal(periodsOf(fallback).length, 8);
  assert.deepEqual(scorecardQuery({ from: "20261015", to: "20261012", group: "day" }, TODAY),
    { from: "20261012", to: "20261015", grouping: "day" }, "a reversed range is read the right way round");
});

test("a range is capped rather than refused", () => {
  const query = scorecardQuery({ from: "20200101", to: "20261018", group: "week" }, TODAY);
  assert.equal(periodsOf(query).length, 26);
  assert.equal(query.to, "20261018");
});

test("precision is confirmed over every decisive review; indeterminate is reported apart", () => {
  const scorecard = buildScorecard({
    cases: [
      day({ reviewed: 20, confirmed: 18, timely_service: 1, partial_service_failure: 0, indeterminate: 1, held: 2,
        review_minutes: 20 * 90 }),
      day({ service_date: "20261015", reviewed: 0 }),
      // Another week and another detector stay out of this one.
      day({ service_date: "20261005", reviewed: 5, confirmed: 0, timely_service: 5 }),
      day({ detector: "gtfs_cancellation", reviewed: 3, confirmed: 3 }),
    ],
    held: [
      { service_date: "20261014", detector: "gtfs_silent_no_show", reason: "feed_gap", count: 1 },
      { service_date: "20261016", detector: "gtfs_silent_no_show", reason: "awaiting_operating_window", count: 1 },
    ],
    avail: [], dispatch: [],
  }, WEEK, TODAY);

  const figures = silent(scorecard);
  assert.equal(figures.sample, 19);
  assert.equal(figures.precision, 18 / 19);
  assert.equal(figures.outcomes.indeterminate, 1);
  assert.equal(figures.cases.detected, 22);
  assert.equal(figures.unknown_rate, 3 / 22, "held cases and indeterminate reviews");
  assert.deepEqual(figures.held_reasons.map((r) => r.reason).sort(), ["awaiting_operating_window", "feed_gap"]);
  assert.equal(figures.review.average_hours_to_review, 1.5);
  assert.equal(scorecard.periods[0].detectors.find((d) => d.detector === "gtfs_cancellation")!.precision, 1);
});

test("a complete week at 95% meets the bar; anything short says why", () => {
  const ended = true;
  const base = { detector: "gtfs_silent_no_show" as const, cases: { awaiting_review: 0, open: 0 } as never };
  assert.equal(weekBar({ ...base, precision: 0.96, sample: 50 }, ended).meets_bar, true);
  assert.match(weekBar({ ...base, precision: 0.9, sample: 50 }, ended).sentence, /90\.0% precision over 50 case\(s\) is below 95%/);
  assert.match(weekBar({ ...base, precision: 1, sample: 50 }, false).sentence, /has not ended/);
  assert.equal(weekBar({ ...base, precision: 1, sample: 50 }, false).meets_bar, false);
  assert.match(weekBar({ ...base, cases: { awaiting_review: 3, open: 1 } as never, precision: 1, sample: 5 }, ended).sentence,
    /4 case\(s\) still waiting/);
  assert.match(weekBar({ ...base, precision: null, sample: 0 }, ended).sentence, /No case was reviewed/);
  assert.match(weekBar({ ...base, detector: "spare", precision: 1, sample: 9 }, ended).sentence, /dispatcher agreement/);
});

test("this week has not ended, so it cannot meet the bar however good it looks", () => {
  const scorecard = buildScorecard({
    cases: [day({ service_date: "20261019", reviewed: 40, confirmed: 40 })],
    held: [], avail: [], dispatch: [],
  }, { from: "20261019", to: "20261025", grouping: "week" }, TODAY);
  assert.equal(scorecard.periods[0].ended, false);
  assert.equal(silent(scorecard).bar?.meets_bar, false);
});

test("a day grouping carries no bar", () => {
  const scorecard = buildScorecard({ cases: [day({ reviewed: 1, confirmed: 1 })], held: [], avail: [], dispatch: [] },
    { from: "20261014", to: "20261015", grouping: "day" }, TODAY);
  assert.equal(scorecard.periods.length, 2);
  assert.equal(silent(scorecard).bar, null);
  assert.equal(silent(scorecard, 1).sample, 0);
});

test("Avail recall leaves probable links out until a reviewer places them", () => {
  const scorecard = buildScorecard({
    cases: [],
    held: [],
    avail: [{ service_date: "20261013", whole_misses: 10, caught: 6, linked_not_flagged: 1, awaiting_reviewer: 1, unmatched: 2 }],
    dispatch: [{ service_date: "20261013", verifications: 300, not_observed: 4, caught: 3 }],
  }, WEEK, TODAY);
  const period = scorecard.periods[0];
  assert.equal(period.avail_recall?.recall, 6 / 9);
  assert.equal(period.avail_recall?.unmatched_rate, 2 / 10);
  assert.deepEqual(period.dispatcher_recall, { verifications: 300, not_observed: 4, caught: 3, missed: 1, recall: 0.75 });
});

test("dispatcher agreement counts a trip seen leaving late as a disagreement", () => {
  const scorecard = buildScorecard({
    cases: [day({ dispatcher_not_observed: 6, dispatcher_on_time: 1, dispatcher_left_late: 1 })],
    held: [], avail: [], dispatch: [],
  }, WEEK, TODAY);
  assert.equal(silent(scorecard).dispatcher?.agreement, 0.75);
});

test("on-demand has no Avail or Dispatch Log comparison, and a missing source is null, not zero", () => {
  const scorecard = buildScorecard({ cases: [day({ detector: "spare", reviewed: 2, confirmed: 2 })], held: [], avail: null, dispatch: null },
    WEEK, TODAY);
  const spare = scorecard.periods[0].detectors.find((d) => d.detector === "spare")!;
  assert.equal(spare.avail, null);
  assert.equal(spare.dispatcher, null);
  assert.equal(silent(scorecard).avail, null, "no AvailEvidenceLinks table");
  assert.equal(scorecard.periods[0].avail_recall, null);
  assert.equal(scorecard.periods[0].dispatcher_recall, null);
  assert.deepEqual(scorecard.sources, { avail: false, dispatch_log: false });
});
