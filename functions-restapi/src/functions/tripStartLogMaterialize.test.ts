import test from "node:test";
import assert from "node:assert/strict";
import { anchorFromSchedule, materializedServiceDates, mayDropUnscheduled } from "./tripStartLogMaterialize";

test("seeds the rotation anchor from the earliest calendar start date", () => {
  const calendar = [
    { service_id: "A", monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false, start_date: "20260908", end_date: "20261212" },
    { service_id: "B", monday: false, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: true, sunday: true, start_date: "20260906", end_date: "20261212" },
  ];
  assert.equal(anchorFromSchedule(calendar, []), "20260906");
});

test("falls back to the earliest added calendar date for a calendar_dates-only feed", () => {
  const dates = [
    { service_id: "D1", service_date: "20260910", exception_type: 1 as const },
    { service_id: "D2", service_date: "20260908", exception_type: 1 as const },
    { service_id: "D2", service_date: "20260901", exception_type: 2 as const },
  ];
  assert.equal(anchorFromSchedule([], dates), "20260908");
});

test("has no anchor to seed from an empty schedule", () => {
  assert.equal(anchorFromSchedule([], []), null);
});

test("builds today and the next three service days, so Friday evening can print through Monday", () => {
  // 09:30 UTC on Friday 6 November 2026 is 03:30 Central, the timer's slot.
  const days = materializedServiceDates(new Date("2026-11-06T09:30:00Z"));
  assert.deepEqual(days, [
    { serviceDate: "20261106", dow: "friday" },
    { serviceDate: "20261107", dow: "saturday" },
    { serviceDate: "20261108", dow: "sunday" },
    { serviceDate: "20261109", dow: "monday" },
  ]);
});

test("counts the days in Central time across a month end", () => {
  // 02:00 UTC on 1 December is still 30 November in Central.
  const days = materializedServiceDates(new Date("2026-12-01T02:00:00Z")).map((d) => d.serviceDate);
  assert.deepEqual(days, ["20261130", "20261201", "20261202", "20261203"]);
});

test("drops unscheduled trips only from days that have not started", () => {
  assert.equal(mayDropUnscheduled("20261107", "20261106", 812), true);
  assert.equal(mayDropUnscheduled("20261106", "20261106", 812), false, "today carries actuals and counts");
  assert.equal(mayDropUnscheduled("20261105", "20261106", 812), false);
});

test("never drops on an empty schedule read", () => {
  assert.equal(mayDropUnscheduled("20261107", "20261106", 0), false);
});
