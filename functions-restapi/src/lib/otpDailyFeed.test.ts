import { test } from "node:test";
import assert from "node:assert";
import { mapOtpDailyReport, otpDailyCoverage, otpDailyWindow, type AvailOtpDailyReport } from "./otpDailyFeed";

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

// --- when to ask (confirmed against the live feed 2026-09-17) ---

test("a 12:00 UTC run asks for the three completed Central service days before today", () => {
  // 2026-09-17 12:00 UTC is 07:00 CDT on the 17th: the 16th has ended.
  const window = otpDailyWindow(new Date("2026-09-17T12:00:00Z"));
  assert.deepStrictEqual(window.serviceDates, ["20260914", "20260915", "20260916"]);
  assert.strictEqual(window.requestStart.toISOString(), "2026-09-14T00:00:00.000Z");
  assert.strictEqual(window.requestEnd.toISOString(), "2026-09-16T00:00:00.000Z");
});

test("the window never includes the Central day still in service, whatever the UTC date says", () => {
  // The old 03:30 UTC run: 22:30 CDT on the 16th. UTC calls the 16th
  // "yesterday", but it is the day still running - Avail has nothing for it.
  const window = otpDailyWindow(new Date("2026-09-17T03:30:00Z"));
  assert.ok(!window.serviceDates.includes("20260916"));
  assert.strictEqual(window.serviceDates.at(-1), "20260915");
});

test("the window follows the Central calendar across the DST change and in winter", () => {
  // 2026-11-01 is the fall-back day; 12:00 UTC is 06:00 CST.
  assert.deepStrictEqual(otpDailyWindow(new Date("2026-11-01T12:00:00Z")).serviceDates, ["20261029", "20261030", "20261031"]);
  // Just after Central midnight in winter (06:30 UTC = 00:30 CST): the 14th has ended.
  assert.deepStrictEqual(otpDailyWindow(new Date("2026-01-15T06:30:00Z"), 1).serviceDates, ["20260114"]);
  // Just before it (05:30 UTC = 23:30 CST): the 14th is still running.
  assert.deepStrictEqual(otpDailyWindow(new Date("2026-01-15T05:30:00Z"), 1).serviceDates, ["20260113"]);
});

test("coverage ends with the newest day that returned rows, not the newest day asked for", () => {
  const window = otpDailyWindow(new Date("2026-09-17T12:00:00Z"));
  // Avail has published the 14th and 15th but not yet the 16th.
  const coverage = otpDailyCoverage(window, ["20260914", "20260915"]);
  assert.strictEqual(coverage?.startAt?.toISOString(), "2026-09-14T05:00:00.000Z"); // Central midnight, CDT
  assert.strictEqual(coverage?.endAt?.toISOString(), "2026-09-16T05:00:00.000Z"); // end of the 15th
  assert.strictEqual(otpDailyCoverage(window, []), undefined, "nothing stored covers nothing");
});

test("reads Avail's zone-less CalendarDate as a calendar date, not an instant", () => {
  assert.strictEqual(mapOtpDailyReport({ ...CONFIRMED_SAMPLE, CalendarDate: "2026-09-15T00:00:00.000" })!.calendar_date, "20260915");
  assert.strictEqual(mapOtpDailyReport({ ...CONFIRMED_SAMPLE, CalendarDate: "2026-02-30T00:00:00.000" }), null);
  assert.strictEqual(mapOtpDailyReport({ ...CONFIRMED_SAMPLE, CalendarDate: "not a date" }), null);
});
