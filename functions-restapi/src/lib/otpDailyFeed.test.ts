import { test } from "node:test";
import assert from "node:assert";
import { mapOtpDailyReport, type AvailOtpDailyReport } from "./otpDailyFeed";

// Core fields and types confirmed from Avail's live OTP Daily response on
// 2026-08-22. The fixture intentionally contains no rider or location data.
const CONFIRMED_SAMPLE: AvailOtpDailyReport = {
  CalendarDate: "2026-08-21T00:00:00.000",
  Time24Hour: 6,
  StopID: 30535,
  StopInternetName: "Example stop",
  RouteReportLabel: "Example route",
  RouteFareboxID: 446,
  PercentEarly: 0.05,
  PercentOntime: 0.7,
  PercentLate: 0.2,
  PercentNotOntime: 0.25,
  PercentMissed: 0.05,
  Early: 1,
  Ontime: 14,
  Late: 4,
  Missed: 1,
  ActualDepartures: 19,
  Total: 20,
  Latitude: 44.98,
  Longitude: -93.27,
  Direction: "N",
};

test("maps a well-formed daily OTP report", () => {
  const mapped = mapOtpDailyReport(CONFIRMED_SAMPLE);
  assert.ok(mapped);
  assert.strictEqual(mapped!.calendar_date, "20260821");
  assert.strictEqual(mapped!.hour_of_day, 6);
  assert.strictEqual(mapped!.route_id, 446);
  assert.strictEqual(mapped!.stop_id, 30535);
  assert.strictEqual(mapped!.pct_ontime, 0.7);
  assert.strictEqual(mapped!.latitude, 44.98);
  assert.strictEqual(mapped!.direction, "N");
});

test("returns null when RouteFareboxID/StopID/Time24Hour/CalendarDate is missing or malformed", () => {
  assert.strictEqual(mapOtpDailyReport({ ...CONFIRMED_SAMPLE, RouteFareboxID: undefined as unknown as number }), null);
  assert.strictEqual(mapOtpDailyReport({ ...CONFIRMED_SAMPLE, StopID: undefined as unknown as number }), null);
  assert.strictEqual(mapOtpDailyReport({ ...CONFIRMED_SAMPLE, Time24Hour: undefined as unknown as number }), null);
  assert.strictEqual(mapOtpDailyReport({ ...CONFIRMED_SAMPLE, CalendarDate: "not-a-date" }), null);
});

test("treats optional percent/lat-long fields as null when absent", () => {
  const mapped = mapOtpDailyReport({ ...CONFIRMED_SAMPLE, PercentOntime: null, Latitude: null, Direction: null });
  assert.ok(mapped);
  assert.strictEqual(mapped!.pct_ontime, null);
  assert.strictEqual(mapped!.latitude, null);
  assert.strictEqual(mapped!.direction, null);
});
