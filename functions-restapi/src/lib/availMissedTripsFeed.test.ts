import { test } from "node:test";
import assert from "node:assert";
import { mapMissedTripReport, type AvailMissedTripReport } from "./availMissedTripsFeed";

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
