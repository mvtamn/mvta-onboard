import { test } from "node:test";
import assert from "node:assert";
import { mapOtpDailyReport, fetchOtpDailyReports, type AvailOtpDailyReport } from "./otpDailyFeed";

// No real sample response exists for this feed anywhere (see the file's own
// header comment) - this fixture is a best-guess shape, not a confirmed one.
const GUESSED_SAMPLE: AvailOtpDailyReport = {
  CalendarDate: "2026-08-04T00:00:00.0000000+00:00",
  HourOfDay: 8,
  StopID: 3242,
  StopInternetName: "29th Ave S and 18th St S",
  RouteReportLabel: "MCC  - Magic Cit",
  RouteID: 90,
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

function withFetchStub(response: unknown, run: () => Promise<void>): Promise<void> {
  const original = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  })) as unknown as typeof fetch;
  return run().finally(() => {
    global.fetch = original;
  });
}

test("maps a well-formed daily OTP report", () => {
  const mapped = mapOtpDailyReport(GUESSED_SAMPLE);
  assert.ok(mapped);
  assert.strictEqual(mapped!.calendar_date, "20260804");
  assert.strictEqual(mapped!.hour_of_day, 8);
  assert.strictEqual(mapped!.route_id, 90);
  assert.strictEqual(mapped!.stop_id, 3242);
  assert.strictEqual(mapped!.pct_ontime, 0.7);
  assert.strictEqual(mapped!.latitude, 44.98);
  assert.strictEqual(mapped!.direction, "N");
});

test("returns null when RouteID/StopID/HourOfDay/CalendarDate is missing or malformed", () => {
  assert.strictEqual(mapOtpDailyReport({ ...GUESSED_SAMPLE, RouteID: undefined as unknown as number }), null);
  assert.strictEqual(mapOtpDailyReport({ ...GUESSED_SAMPLE, StopID: undefined as unknown as number }), null);
  assert.strictEqual(mapOtpDailyReport({ ...GUESSED_SAMPLE, HourOfDay: undefined as unknown as number }), null);
  assert.strictEqual(mapOtpDailyReport({ ...GUESSED_SAMPLE, CalendarDate: "not-a-date" }), null);
});

test("treats optional percent/lat-long fields as null when absent", () => {
  const mapped = mapOtpDailyReport({ ...GUESSED_SAMPLE, PercentOntime: null, Latitude: null, Direction: null });
  assert.ok(mapped);
  assert.strictEqual(mapped!.pct_ontime, null);
  assert.strictEqual(mapped!.latitude, null);
  assert.strictEqual(mapped!.direction, null);
});

test("fetchOtpDailyReports returns the rows when the guessed envelope key matches", () =>
  withFetchStub(
    { success: true, errors: [], result: { OtpByRouteStopDayHour: [GUESSED_SAMPLE] } },
    async () => {
      const rows = await fetchOtpDailyReports("https://example.test/OtpByRouteStopDayHour/v1/MVTA", "key", new Date(), new Date());
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].RouteID, 90);
    },
  ));

test("fetchOtpDailyReports throws naming the real key when the guessed key is wrong", () =>
  withFetchStub({ success: true, errors: [], result: { otpByRouteStopDayHour: [GUESSED_SAMPLE] } }, async () => {
    await assert.rejects(
      () => fetchOtpDailyReports("https://example.test/OtpByRouteStopDayHour/v1/MVTA", "key", new Date(), new Date()),
      /otpByRouteStopDayHour/,
    );
  }));

test("fetchOtpDailyReports returns an empty array when result is genuinely empty", () =>
  withFetchStub({ success: true, errors: [], result: {} }, async () => {
    const rows = await fetchOtpDailyReports("https://example.test/OtpByRouteStopDayHour/v1/MVTA", "key", new Date(), new Date());
    assert.deepStrictEqual(rows, []);
  }));
