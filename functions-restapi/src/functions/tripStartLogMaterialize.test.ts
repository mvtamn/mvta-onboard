import test from "node:test";
import assert from "node:assert/strict";
import { anchorFromSchedule } from "./tripStartLogMaterialize";

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
