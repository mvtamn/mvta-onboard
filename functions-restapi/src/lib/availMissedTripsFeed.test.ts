import { test } from "node:test";
import assert from "node:assert";
import { mapMissedTripReport, fetchMissedTripReports, type AvailMissedTripReport } from "./availMissedTripsFeed";

// Same fetch-stub convention as otpMonthlyFeed.test.ts/availDetoursFeed.test.ts.
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

// Fixture from OTP-Feed-Evaluation-and-Recommendation.md's own example response.
const BIRMINGHAM_EXPRESS: AvailMissedTripReport = {
  DepartureStopID: 3600,
  DepartureStopName: "West Terminus",
  ArrivalStopID: 3617,
  ArrivalStopName: "WoodlawnTerminu",
  RouteID: 100,
  RouteDesc: "BX-Birmingham Express",
  RouteInternetName: "BX-Birmingham Express",
  CalendarDate: "2025-08-12T00:00:00.0000000+00:00",
  DepartureMissed: 1,
  ArrivalMissed: 1,
  EntireTripMissed: 1,
  DepartureTripStartTime: null,
};

test("maps a missed-trip incident record", () => {
  const mapped = mapMissedTripReport(BIRMINGHAM_EXPRESS);
  assert.ok(mapped);
  assert.strictEqual(mapped!.calendar_date, "20250812");
  assert.strictEqual(mapped!.service_month, "202508");
  assert.strictEqual(mapped!.route_id, 100);
  assert.strictEqual(mapped!.route_desc, "BX-Birmingham Express");
  assert.strictEqual(mapped!.departure_stop_id, 3600);
  assert.strictEqual(mapped!.arrival_stop_id, 3617);
  assert.strictEqual(mapped!.departure_missed, true);
  assert.strictEqual(mapped!.arrival_missed, true);
  assert.strictEqual(mapped!.entire_trip_missed, true);
  assert.strictEqual(mapped!.departure_trip_start_time, null);
});

test("returns null when RouteID or CalendarDate is missing/malformed", () => {
  assert.strictEqual(mapMissedTripReport({ ...BIRMINGHAM_EXPRESS, RouteID: undefined as unknown as number }), null);
  assert.strictEqual(mapMissedTripReport({ ...BIRMINGHAM_EXPRESS, CalendarDate: "" }), null);
  assert.strictEqual(mapMissedTripReport({ ...BIRMINGHAM_EXPRESS, CalendarDate: "not-a-date" }), null);
});

test("treats a departure-only miss (arrival not missed) correctly", () => {
  const mapped = mapMissedTripReport({ ...BIRMINGHAM_EXPRESS, ArrivalMissed: 0, EntireTripMissed: 0 });
  assert.ok(mapped);
  assert.strictEqual(mapped!.departure_missed, true);
  assert.strictEqual(mapped!.arrival_missed, false);
  assert.strictEqual(mapped!.entire_trip_missed, false);
});

test("combines Avail's HH:mm start time with CalendarDate in agency-local time", () => {
  const mapped = mapMissedTripReport({
    ...BIRMINGHAM_EXPRESS,
    CalendarDate: "2026-07-29T00:00:00.000",
    DepartureTripStartTime: "14:31",
  });
  assert.strictEqual(mapped?.departure_trip_start_time?.toISOString(), "2026-07-29T19:31:00.000Z");
});

test("fetchMissedTripReports returns the rows under the real (lowercase) envelope key", () =>
  withFetchStub(
    { success: true, errors: [], result: { missed: [BIRMINGHAM_EXPRESS] } },
    async () => {
      const rows = await fetchMissedTripReports("https://example.test/MissedTripsByRouteStopDay/v1/MVTA", "key", new Date(), new Date());
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].RouteID, 100);
    },
  ));

test("fetchMissedTripReports throws naming the real key when the guessed key is wrong", () =>
  withFetchStub({ success: true, errors: [], result: { MissedTripsByRouteStopDay: [BIRMINGHAM_EXPRESS] } }, async () => {
    await assert.rejects(
      () => fetchMissedTripReports("https://example.test/MissedTripsByRouteStopDay/v1/MVTA", "key", new Date(), new Date()),
      /MissedTripsByRouteStopDay/,
    );
  }));

test("fetchMissedTripReports returns an empty array when result is genuinely empty", () =>
  withFetchStub({ success: true, errors: [], result: {} }, async () => {
    const rows = await fetchMissedTripReports("https://example.test/MissedTripsByRouteStopDay/v1/MVTA", "key", new Date(), new Date());
    assert.deepStrictEqual(rows, []);
  }));
