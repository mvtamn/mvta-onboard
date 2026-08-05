import { test } from "node:test";
import assert from "node:assert";
import { mapOtpMonthlyReport, serviceMonthOf, formatDateMmDdYyyy, type OtpMonthlyReport } from "./otpMonthlyFeed";

// Fixture from OTP-Feed-Evaluation-and-Recommendation.md's own example response.
const MAGIC_CITY: OtpMonthlyReport = {
  DayOfWeek: "Wed",
  StopID: 3242,
  StopInternetName: "29th Ave S and 18th St S",
  RouteReportLabel: "MCC  - Magic Cit",
  RouteID: 90,
  PercentEarly: 0.0407,
  PercentOntime: 0.2733,
  PercentLate: 0.1919,
  PercentNotOntime: 0.2384,
  PercentMissed: 0.4884,
  Early: 7,
  Ontime: 47,
  Late: 33,
  Missed: 84,
  ActualDepartures: 88,
  Total: 172,
};

test("maps an OTP monthly report and stamps the request's service_month", () => {
  const mapped = mapOtpMonthlyReport(MAGIC_CITY, "202607");
  assert.ok(mapped);
  assert.strictEqual(mapped!.service_month, "202607");
  assert.strictEqual(mapped!.route_id, 90);
  assert.strictEqual(mapped!.stop_id, 3242);
  assert.strictEqual(mapped!.day_of_week, "Wed");
  assert.strictEqual(mapped!.stop_name, "29th Ave S and 18th St S");
  assert.strictEqual(mapped!.route_label, "MCC  - Magic Cit");
  assert.strictEqual(mapped!.pct_ontime, 0.2733);
  assert.strictEqual(mapped!.missed, 84);
  assert.strictEqual(mapped!.total, 172);
});

test("returns null when RouteID/StopID/DayOfWeek is missing or non-numeric", () => {
  assert.strictEqual(mapOtpMonthlyReport({ ...MAGIC_CITY, RouteID: undefined as unknown as number }, "202607"), null);
  assert.strictEqual(mapOtpMonthlyReport({ ...MAGIC_CITY, StopID: undefined as unknown as number }, "202607"), null);
  assert.strictEqual(mapOtpMonthlyReport({ ...MAGIC_CITY, DayOfWeek: "" }, "202607"), null);
});

test("formatDateMmDdYyyy formats as MM-DD-YYYY", () => {
  assert.strictEqual(formatDateMmDdYyyy(new Date("2026-07-04T00:00:00Z")), "07-04-2026");
});

test("serviceMonthOf formats as YYYYMM", () => {
  assert.strictEqual(serviceMonthOf(new Date("2026-07-04T00:00:00Z")), "202607");
});
