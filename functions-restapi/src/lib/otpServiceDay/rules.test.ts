import assert from "node:assert/strict";
import test from "node:test";
import {
  affectedDayOfWeek,
  anyEvidence,
  evidenceFor,
  median,
  MIN_COMPARISON_DATES,
  REDUCED_SERVICE_SHARE,
  type DailyDateTotal,
} from "./index";
import type { ReducedServiceDay } from "./types";

const day = (service_date: string, day_of_week: string): Pick<ReducedServiceDay, "service_date" | "day_of_week"> =>
  ({ service_date, day_of_week });

const total = (service_date: string, day_of_week: string, departures: number): DailyDateTotal =>
  ({ service_date, day_of_week, departures });

// The real September: Labor Day on the 7th, ordinary Mondays on the 14th and
// 21st, at the volumes dev actually carried.
const SEPTEMBER: DailyDateTotal[] = [
  total("20260907", "Mon", 1043),
  total("20260914", "Mon", 2548),
  total("20260921", "Mon", 2601),
  total("20260920", "Sun", 1003),
];

test("the median averages the two middles, and has nothing to say about nothing", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([2548, 2601]), 2574.5);
  assert.equal(median([1, 100, 2]), 2);
});

test("Labor Day is corroborated against its own month's Mondays", () => {
  const evidence = evidenceFor(day("20260907", "Mon"), SEPTEMBER, new Set(["20260907"]));
  assert.equal(evidence.coverage, "corroborated");
  assert.equal(evidence.departures, 1043);
  // The declared day is excluded from its own comparison, so typical is the
  // median of the 14th and the 21st, not of all three.
  assert.equal(evidence.typical, 2574.5);
  assert.ok(evidence.share !== null && evidence.share < REDUCED_SERVICE_SHARE);
});

test("a second declared day cannot drag the comparison toward itself", () => {
  // Two holidays in one Monday bucket: neither counts as a normal Monday.
  const twoHolidays = [...SEPTEMBER, total("20260928", "Mon", 1050)];
  const declared = new Set(["20260907", "20260928"]);
  const evidence = evidenceFor(day("20260907", "Mon"), twoHolidays, declared);
  assert.equal(evidence.typical, 2574.5);
  assert.equal(evidence.coverage, "corroborated");
});

test("a declared day that ran a full schedule is contradicted, not quietly accepted", () => {
  // The finding, not an error: somebody declared the wrong date, or the
  // schedule was not actually reduced.
  const wrong = [total("20260914", "Mon", 2548), total("20260921", "Mon", 2601), total("20260907", "Mon", 2560)];
  const evidence = evidenceFor(day("20260907", "Mon"), wrong, new Set(["20260907"]));
  assert.equal(evidence.coverage, "contradicted");
  assert.ok(evidence.share !== null && evidence.share >= REDUCED_SERVICE_SHARE);
});

test("the feed says nothing about a date it does not hold", () => {
  // The case that decided the whole design: the daily feed holds nothing
  // before 2026-09-14, so it cannot see Labor Day at all.
  const later = SEPTEMBER.filter((t) => t.service_date !== "20260907");
  const evidence = evidenceFor(day("20260907", "Mon"), later, new Set(["20260907"]));
  assert.deepEqual(evidence, {
    service_date: "20260907", coverage: "no_daily_data", departures: null, typical: null, share: null,
  });
});

test("one comparable date is not a comparison", () => {
  const thin = [total("20260907", "Mon", 1043), total("20260914", "Mon", 2548)];
  const evidence = evidenceFor(day("20260907", "Mon"), thin, new Set(["20260907"]));
  assert.equal(evidence.coverage, "insufficient_comparison");
  // What the feed does know still travels.
  assert.equal(evidence.departures, 1043);
  assert.equal(evidence.typical, null);
  assert.equal(MIN_COMPARISON_DATES, 2);
});

test("only the same day of week, in the same month, is comparable", () => {
  const acrossMonths = [
    total("20260907", "Mon", 1043),
    total("20260803", "Mon", 2500), // August: a different month's Monday
    total("20260810", "Mon", 2520),
    total("20260920", "Sun", 1003), // September, but a Sunday
  ];
  const evidence = evidenceFor(day("20260907", "Mon"), acrossMonths, new Set(["20260907"]));
  // August's Mondays and September's Sunday are both ineligible, leaving none.
  assert.equal(evidence.coverage, "insufficient_comparison");
});

test("each affected bucket is named once, however many days landed in it", () => {
  const days = [
    { service_date: "20260907", day_of_week: "Mon" },
    { service_date: "20260928", day_of_week: "Mon" },
    { service_date: "20261126", day_of_week: "Thur" },
  ] as ReducedServiceDay[];
  assert.deepEqual(affectedDayOfWeek(days), ["Mon", "Thur"]);
  assert.deepEqual(affectedDayOfWeek([]), []);
});

test("a month with no usable evidence says so rather than showing a blank", () => {
  assert.equal(anyEvidence([{ service_date: "x", coverage: "no_daily_data", departures: null, typical: null, share: null }]), false);
  assert.equal(anyEvidence([{ service_date: "x", coverage: "corroborated", departures: 1, typical: 2, share: 0.5 }]), true);
  // A contradiction is evidence too - it is the finding.
  assert.equal(anyEvidence([{ service_date: "x", coverage: "contradicted", departures: 2, typical: 2, share: 1 }]), true);
});
