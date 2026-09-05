import test from "node:test";
import assert from "node:assert/strict";
import type { GtfsCalendarDateRow, GtfsCalendarRow } from "./gtfsStatic";
import {
  computeRotation,
  inRotation,
  isValidServiceDate,
  rotationDayFor,
  rotationWeekDates,
  rotationWeekOffset,
  type RotationTrip,
} from "./tripStartRotation";

// 2026-08-10 is a Monday, matching the workbook's "8-10 - 8-16" sheet.
const ANCHOR = "20260810";

function calendarRow(service_id: string, days: string[], start = "20260810", end = "20261231"): GtfsCalendarRow {
  return {
    service_id,
    monday: days.includes("monday"),
    tuesday: days.includes("tuesday"),
    wednesday: days.includes("wednesday"),
    thursday: days.includes("thursday"),
    friday: days.includes("friday"),
    saturday: days.includes("saturday"),
    sunday: days.includes("sunday"),
    start_date: start,
    end_date: end,
  };
}

const CALENDAR: GtfsCalendarRow[] = [
  calendarRow("WK", ["monday", "tuesday", "wednesday", "thursday"]),
  calendarRow("FRI", ["friday"]),
  calendarRow("WE", ["saturday", "sunday"]),
];

function trip(trip_id: string, service_id: string, hhmm: string): RotationTrip {
  const [h, m] = hhmm.split(":").map(Number);
  return { trip_id, service_id, first_departure_seconds: h * 3600 + m * 60 };
}

test("counts whole weeks from the anchor, including before it", () => {
  assert.equal(rotationWeekOffset(ANCHOR, "20260810"), 0);
  assert.equal(rotationWeekOffset(ANCHOR, "20260816"), 0);
  assert.equal(rotationWeekOffset(ANCHOR, "20260817"), 1);
  assert.equal(rotationWeekOffset(ANCHOR, "20260809"), -1);
});

test("a rotation week is the seven dates from the anchor plus whole weeks", () => {
  const week = rotationWeekDates(ANCHOR, 1);
  assert.equal(week[0]?.date, "20260817");
  assert.equal(week[0]?.dow, "monday");
  assert.equal(week[6]?.date, "20260823");
  assert.equal(week[6]?.dow, "sunday");
});

test("deals weekday trips in start-time order and shifts one day each week", () => {
  const trips = [
    trip("t-0320", "WK", "03:20"),
    trip("t-0400", "WK", "04:00"),
    trip("t-0430", "WK", "04:30"),
    trip("t-0500", "WK", "05:00"),
    trip("t-0530", "WK", "05:30"),
    trip("t-0600", "WK", "06:00"),
  ];
  // Block 1's 03:20 trip is Monday in "8-10 - 8-16" and Tuesday in "8-17 - 8-23".
  const weekZero = computeRotation(trips, CALENDAR, [], ANCHOR, "20260810");
  assert.equal(rotationDayFor(weekZero, "t-0320", "monday"), "monday");
  assert.equal(rotationDayFor(weekZero, "t-0400", "monday"), "tuesday");
  assert.equal(rotationDayFor(weekZero, "t-0600", "monday"), "monday");
  const weekOne = computeRotation(trips, CALENDAR, [], ANCHOR, "20260818");
  assert.equal(rotationDayFor(weekOne, "t-0320", "tuesday"), "tuesday");
  assert.equal(rotationDayFor(weekOne, "t-0530", "tuesday"), "monday");
});

test("breaks equal start times on trip_id so the deal is reproducible", () => {
  const trips = [trip("b", "WK", "05:00"), trip("a", "WK", "05:00"), trip("c", "WK", "05:00")];
  const forward = computeRotation(trips, CALENDAR, [], ANCHOR, "20260810");
  const reversed = computeRotation([...trips].reverse(), CALENDAR, [], ANCHOR, "20260810");
  assert.equal(rotationDayFor(forward, "a", "monday"), "monday");
  assert.equal(rotationDayFor(forward, "b", "monday"), "tuesday");
  assert.equal(rotationDayFor(forward, "c", "monday"), "wednesday");
  assert.deepEqual([...forward.assignments], [...reversed.assignments]);
});

test("Friday-only and Mon-Thu-only trips share one weekday pool; the weekend pool is separate", () => {
  const trips = [
    trip("wk-1", "WK", "05:00"),
    trip("fri-1", "FRI", "05:10"),
    trip("we-1", "WE", "05:20"),
    trip("wk-2", "WK", "05:30"),
  ];
  const rotation = computeRotation(trips, CALENDAR, [], ANCHOR, "20260810");
  assert.equal(rotation.weekday_pool_size, 3);
  assert.equal(rotation.weekend_pool_size, 1);
  assert.deepEqual(rotation.assignments.get("we-1"), { weekday_day: null, weekend_day: "saturday" });
  assert.deepEqual(rotation.assignments.get("fri-1"), { weekday_day: "tuesday", weekend_day: null });
});

test("a Mon-Thu trip dealt to Friday is simply not on Friday's list; the caller filters to trips that run", () => {
  // Five WK trips: index 4 is dealt to Friday in week 0 even though WK does
  // not run on Friday. in_rotation reports it for Friday; the materializer
  // only asks about trips active that date, so the row never appears.
  const trips = ["a", "b", "c", "d", "e"].map((id, i) => trip(id, "WK", `0${5 + i}:00`));
  const rotation = computeRotation(trips, CALENDAR, [], ANCHOR, "20260814");
  assert.equal(rotationDayFor(rotation, "e", "friday"), "friday");
  assert.equal(inRotation(rotation, "e", "friday"), true);
  assert.equal(inRotation(rotation, "a", "friday"), false);
  assert.equal(inRotation(rotation, "a", "monday"), true);
});

test("a calendar_dates-only feed still populates both pools", () => {
  // MVTA's feed publishes service through calendar_dates.txt alone.
  const dates: GtfsCalendarDateRow[] = [
    { service_id: "D-WK", service_date: "20260811", exception_type: 1 },
    { service_id: "D-WK", service_date: "20260812", exception_type: 1 },
    { service_id: "D-WE", service_date: "20260815", exception_type: 1 },
  ];
  const trips = [trip("x", "D-WK", "06:00"), trip("y", "D-WE", "06:00")];
  const rotation = computeRotation(trips, [], dates, ANCHOR, "20260811");
  assert.equal(rotation.weekday_pool_size, 1);
  assert.equal(rotation.weekend_pool_size, 1);
  assert.equal(inRotation(rotation, "x", "monday"), true);
  assert.equal(inRotation(rotation, "y", "saturday"), true);
});

test("a service from a future service change stays out of this week's pools", () => {
  const calendar = [...CALENDAR, calendarRow("NEXT", ["monday", "tuesday"], "20260908", "20261231")];
  const trips = [trip("now", "WK", "05:00"), trip("later", "NEXT", "04:00")];
  const rotation = computeRotation(trips, calendar, [], ANCHOR, "20260810");
  assert.equal(rotation.weekday_pool_size, 1);
  assert.equal(rotation.assignments.has("later"), false);
  assert.equal(rotationDayFor(rotation, "now", "monday"), "monday");
});

test("a removed date drops the service from that week's pool", () => {
  const dates: GtfsCalendarDateRow[] = ["20260810", "20260811", "20260812", "20260813"].map((service_date) => ({
    service_id: "WK", service_date, exception_type: 2 as const,
  }));
  const rotation = computeRotation([trip("t", "WK", "05:00")], CALENDAR, dates, ANCHOR, "20260810");
  assert.equal(rotation.weekday_pool_size, 0);
});

test("validates a YYYYMMDD service date as a real calendar day", () => {
  assert.equal(isValidServiceDate("20260810"), true);
  assert.equal(isValidServiceDate("20260231"), false);
  assert.equal(isValidServiceDate("2026-08-10"), false);
  assert.equal(isValidServiceDate("2026081"), false);
});
