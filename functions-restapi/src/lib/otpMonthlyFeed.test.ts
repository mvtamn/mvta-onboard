import { test } from "node:test";
import assert from "node:assert";
import {
  collapseOtpMonthlyReports,
  describeOtpMonthlyCollision,
  mapOtpMonthlyReport,
  otpRowDiffersSql,
  serviceMonthOf,
  subtractMonths,
  monthsBetween,
  type OtpMonthlyReport,
} from "./otpMonthlyFeed";

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

test("subtractMonths returns the 1st of N months before, within a year", () => {
  const d = subtractMonths(new Date("2026-08-05T12:00:00Z"), 2);
  assert.strictEqual(d.getUTCFullYear(), 2026);
  assert.strictEqual(d.getUTCMonth(), 5); // June (0-indexed)
  assert.strictEqual(d.getUTCDate(), 1);
});

test("subtractMonths rolls back across a year boundary", () => {
  const d = subtractMonths(new Date("2026-01-15T00:00:00Z"), 2);
  assert.strictEqual(d.getUTCFullYear(), 2025);
  assert.strictEqual(d.getUTCMonth(), 10); // November
});

test("serviceMonthOf formats as YYYYMM", () => {
  assert.strictEqual(serviceMonthOf(new Date("2026-07-04T00:00:00Z")), "202607");
});

test("monthsBetween returns an inclusive chronological list within a year", () => {
  assert.deepStrictEqual(monthsBetween("202601", "202605"), [
    "202601",
    "202602",
    "202603",
    "202604",
    "202605",
  ]);
});

test("monthsBetween handles a single month and a year boundary", () => {
  assert.deepStrictEqual(monthsBetween("202608", "202608"), ["202608"]);
  assert.deepStrictEqual(monthsBetween("202511", "202602"), ["202511", "202512", "202601", "202602"]);
});

test("the row-differs test compares every stored value, NULL-safely", () => {
  const sql = otpRowDiffersSql();
  // EXCEPT, not <>: a column going from NULL to a number is exactly the change
  // worth catching, and every <> against NULL is unknown.
  assert.match(sql, /^EXISTS \(SELECT .* EXCEPT SELECT .*\)$/);
  for (const column of ["total", "ontime", "early", "late", "missed", "actual_departures", "pct_ontime", "stop_name", "route_label"]) {
    assert.match(sql, new RegExp(`target\\.${column}\\b`), `compares ${column}`);
    assert.match(sql, new RegExp(`@${column}\\b`), `against @${column}`);
  }
  // Key columns are what the MERGE matched on; comparing them would be circular.
  for (const key of ["service_month", "route_id", "stop_id", "day_of_week"]) {
    assert.doesNotMatch(sql, new RegExp(`target\\.${key}\\b`), `does not compare the key ${key}`);
  }
  // Both sides must list the same number of columns or EXCEPT will not parse.
  const [left, right] = sql.replace(/^EXISTS \(SELECT /, "").replace(/\)$/, "").split(" EXCEPT SELECT ");
  assert.equal(left.split(",").length, right.split(",").length);
});

test("the differs test is aliasable and refuses anything that is not an identifier", () => {
  assert.match(otpRowDiffersSql("t"), /t\.total/);
  assert.throws(() => otpRowDiffersSql("target; DROP"), TypeError);
});

// --- two records on one key (2026-03) -------------------------------------
//
// Shaped on the live collision: route 497 stop 31780 Monday came back as 34
// departures and as 54, and the month is the 88 the neighbouring stop reports.
function monthly(overrides: Partial<OtpMonthlyReport>): OtpMonthlyReport {
  return { ...MAGIC_CITY, ...overrides };
}

function candidate(overrides: Partial<OtpMonthlyReport>, serviceMonth = "202603") {
  const source = monthly(overrides);
  return { mapped: mapOtpMonthlyReport(source, serviceMonth)!, source };
}

test("sums the records that share a key, so a second pattern is not overwritten", () => {
  const { rows, collisions } = collapseOtpMonthlyReports([
    candidate({ RouteID: 497, StopID: 31780, DayOfWeek: "Mon", Total: 34, Ontime: 29, Early: 2, Late: 3, Missed: 0, ActualDepartures: 34, PercentOntime: 29 / 34 }),
    candidate({ RouteID: 497, StopID: 31780, DayOfWeek: "Mon", Total: 54, Ontime: 51, Early: 1, Late: 2, Missed: 0, ActualDepartures: 54, PercentOntime: 51 / 54 }),
  ]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].row.total, 88);
  assert.strictEqual(rows[0].row.ontime, 80);
  assert.strictEqual(rows[0].row.early, 3);
  assert.strictEqual(rows[0].row.actual_departures, 88);
  // Every delivered record is accounted for, or feed health reads the collapse
  // as a record that went missing.
  assert.strictEqual(rows[0].recordCount, 2);
  assert.strictEqual(collisions.length, 1);
  assert.strictEqual(collisions[0].resolution, "summed");
});

test("recomputes a percentage as the weighted mean, not the arithmetic one", () => {
  const { rows } = collapseOtpMonthlyReports([
    candidate({ RouteID: 1, StopID: 1, DayOfWeek: "Mon", Total: 10, Ontime: 10, PercentOntime: 1 }),
    candidate({ RouteID: 1, StopID: 1, DayOfWeek: "Mon", Total: 90, Ontime: 45, PercentOntime: 0.5 }),
  ]);
  // (10 + 45) / 100, not (1 + 0.5) / 2.
  assert.strictEqual(rows[0].row.pct_ontime, 0.55);
});

test("keeps one of two records that say exactly the same thing instead of doubling it", () => {
  const twice = { RouteID: 2, StopID: 2, DayOfWeek: "Tues", Total: 40, Ontime: 38 };
  const { rows, collisions } = collapseOtpMonthlyReports([candidate(twice), candidate(twice)]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].row.total, 40);
  assert.strictEqual(rows[0].recordCount, 2);
  assert.strictEqual(collisions[0].resolution, "deduplicated");
});

test("leaves a month with one record per key untouched and reports no collision", () => {
  const { rows, collisions } = collapseOtpMonthlyReports([
    candidate({ RouteID: 3, StopID: 1, DayOfWeek: "Mon" }),
    candidate({ RouteID: 3, StopID: 1, DayOfWeek: "Tues" }),
    candidate({ RouteID: 3, StopID: 2, DayOfWeek: "Mon" }),
  ]);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(collisions, []);
  assert.deepStrictEqual(rows.map((row) => row.recordCount), [1, 1, 1]);
});

test("the same key in two service months is two keys", () => {
  const { rows, collisions } = collapseOtpMonthlyReports([
    candidate({ RouteID: 4, StopID: 1, DayOfWeek: "Mon" }, "202603"),
    candidate({ RouteID: 4, StopID: 1, DayOfWeek: "Mon" }, "202604"),
  ]);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(collisions, []);
});

test("a collision report names the raw fields that differ, including unmapped ones", () => {
  const base = { RouteID: 5, StopID: 9, DayOfWeek: "Mon", Total: 30, Ontime: 28 };
  const first = candidate(base);
  const second = candidate({ ...base, Total: 48, Ontime: 47 });
  // An unmapped field is exactly what a future key would be widened on, so the
  // report has to surface one even though nothing in the mapper reads it.
  (second.source as unknown as Record<string, unknown>).SchedulePatternID = 77;
  const line = describeOtpMonthlyCollision(collapseOtpMonthlyReports([first, second]).collisions[0]);
  assert.match(line, /202603 route 5 stop 9 Mon/);
  assert.match(line, /total=30\/ontime=28 vs total=48\/ontime=47/);
  assert.match(line, /SchedulePatternID=absent\|77/);
  assert.match(line, /summed/);
});

test("a collision report says so when nothing in the payload distinguishes the pair", () => {
  const base = { RouteID: 6, StopID: 9, DayOfWeek: "Wed", Total: 28, Ontime: 25 };
  const line = describeOtpMonthlyCollision(
    collapseOtpMonthlyReports([candidate(base), candidate({ ...base, Ontime: 26 })]).collisions[0],
  );
  assert.match(line, /differing fields: Ontime=25\|26/);
});
