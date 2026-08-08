import { test } from "node:test";
import assert from "node:assert";
import {
  agencyServiceDate,
  calendarDateAndTimeToUtc,
  serviceDateAndGtfsSecondsToUtc,
} from "./missedTripTime";

test("converts a summer GTFS service time from Central daylight time to UTC", () => {
  assert.strictEqual(
    serviceDateAndGtfsSecondsToUtc("20260729", 14 * 3600 + 31 * 60)?.toISOString(),
    "2026-07-29T19:31:00.000Z",
  );
});

test("converts a winter GTFS service time from Central standard time to UTC", () => {
  assert.strictEqual(
    serviceDateAndGtfsSecondsToUtc("20260129", 14 * 3600 + 31 * 60)?.toISOString(),
    "2026-01-29T20:31:00.000Z",
  );
});

test("preserves GTFS past-midnight times on the original service date", () => {
  assert.strictEqual(
    serviceDateAndGtfsSecondsToUtc("20260729", 25 * 3600 + 10 * 60)?.toISOString(),
    "2026-07-30T06:10:00.000Z",
  );
});

test("combines an Avail CalendarDate and HH:mm agency-local start time", () => {
  assert.strictEqual(
    calendarDateAndTimeToUtc("2026-07-29T00:00:00.000", "14:31")?.toISOString(),
    "2026-07-29T19:31:00.000Z",
  );
});

test("uses the agency-local service date around UTC midnight", () => {
  assert.deepStrictEqual(agencyServiceDate(new Date("2026-08-08T02:00:00Z")), {
    serviceDate: "20260807",
    dow: "friday",
  });
  assert.deepStrictEqual(agencyServiceDate(new Date("2026-08-08T02:00:00Z"), -1), {
    serviceDate: "20260806",
    dow: "thursday",
  });
});
