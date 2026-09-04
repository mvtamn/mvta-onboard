import assert from "node:assert";
import { test } from "node:test";
import { scheduleCoverage, serviceDateIsCovered } from "./gtfsScheduleHorizon";
import type { GtfsCalendarDateRow, GtfsCalendarRow } from "./gtfsStatic";

// 2026-09-04T14:00:00Z is 09:00 Friday in America/Chicago, so the agency
// service date is 20260904 and the weekday is friday.
const friday = new Date("2026-09-04T14:00:00.000Z");

function weekdayCalendar(start: string, end: string): GtfsCalendarRow {
  return {
    service_id: "weekday",
    monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
    saturday: false, sunday: false,
    start_date: start, end_date: end,
  };
}

function added(service_date: string): GtfsCalendarDateRow {
  return { service_id: "43-v63", service_date, exception_type: 1 };
}

test("a calendar_dates-only feed covers a day with no GtfsCalendar rows at all", () => {
  // MVTA's real shape: no calendar.txt, one added row per calendar day.
  const coverage = scheduleCoverage([], [added("20260904"), added("20260905")], friday);

  assert.strictEqual(coverage.service_date, "20260904");
  assert.strictEqual(coverage.covered_today, true);
  assert.strictEqual(coverage.days_covered_ahead, 2);
  assert.strictEqual(coverage.last_covered_date, "20260905");
});

test("an expired schedule reports today as uncovered", () => {
  const coverage = scheduleCoverage([weekdayCalendar("20260601", "20260831")], [], friday);

  assert.strictEqual(coverage.covered_today, false);
  assert.strictEqual(coverage.days_covered_ahead, 0);
  assert.strictEqual(coverage.last_covered_date, null);
});

test("consecutive coverage stops at the first uncovered day", () => {
  // Covered today and tomorrow, then a gap, then more service. Reporting when
  // it stops is the useful signal, not the total number of covered days.
  const coverage = scheduleCoverage(
    [],
    [added("20260904"), added("20260905"), added("20260908")],
    friday,
  );

  assert.strictEqual(coverage.days_covered_ahead, 2);
  assert.strictEqual(coverage.last_covered_date, "20260905");
});

test("the lookahead window caps how far ahead coverage is counted", () => {
  const everyDay = Array.from({ length: 40 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 4 + i));
    return added(
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`,
    );
  });
  const coverage = scheduleCoverage([], everyDay, friday, 14);

  assert.strictEqual(coverage.days_covered_ahead, 15); // today + 14 ahead
});

test("a weekday calendar does not cover a Saturday inside its date range", () => {
  const calendar = [weekdayCalendar("20260101", "20261231")];

  assert.strictEqual(serviceDateIsCovered(calendar, [], "20260904", "friday"), true);
  assert.strictEqual(serviceDateIsCovered(calendar, [], "20260905", "saturday"), false);
});

test("an exception_type 2 removal cancels a day the calendar would otherwise run", () => {
  // Matches activeServiceIdsToday's NOT EXISTS clause: a holiday override
  // removes service the weekday calendar claims.
  const calendar = [weekdayCalendar("20260101", "20261231")];
  const holiday: GtfsCalendarDateRow = {
    service_id: "weekday", service_date: "20260904", exception_type: 2,
  };

  assert.strictEqual(serviceDateIsCovered(calendar, [holiday], "20260904", "friday"), false);
});

test("a removal for a different service does not cancel the day", () => {
  const calendar = [weekdayCalendar("20260101", "20261231")];
  const other: GtfsCalendarDateRow = {
    service_id: "saturday", service_date: "20260904", exception_type: 2,
  };

  assert.strictEqual(serviceDateIsCovered(calendar, [other], "20260904", "friday"), true);
});
