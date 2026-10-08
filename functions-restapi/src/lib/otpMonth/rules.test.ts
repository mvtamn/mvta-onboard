import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  AVAIL_DAY_OF_WEEK,
  availDayOfWeek,
  isOtpRowAssessable,
  otpAssessableCount,
  otpAssessableCountSql,
  otpAssessableJoinsSql,
  otpAssessableSql,
  otpDateExcludedJoinSql,
  otpRouteCategorySql,
} from "./rules";
import { otpRouteFiguresSql } from "./index";

test("a fixed-route row with no approved stop exclusion is what counts", () => {
  assert.equal(isOtpRowAssessable({ route_category: "FixedRoute", stop_excluded: false }), true);
  // A route nobody has classified counts, so a new route cannot escape the
  // standard by being unknown.
  assert.equal(isOtpRowAssessable({ route_category: null, stop_excluded: false }), true);
  assert.equal(isOtpRowAssessable({ route_category: "SpecialEvent", stop_excluded: false }), false);
  assert.equal(isOtpRowAssessable({ route_category: "OnDemand", stop_excluded: false }), false);
  assert.equal(isOtpRowAssessable({ route_category: "FixedRoute", stop_excluded: true }), false);
});

test("aliases are checked before they reach SQL", () => {
  assert.throws(() => otpAssessableSql("classification; DROP", "exclusion"), TypeError);
  assert.throws(() => otpAssessableJoinsSql("otp; DROP"), TypeError);
  assert.throws(() => otpRouteCategorySql("x-y"), TypeError);
});

test("an exclusion is matched at the grain the monthly feed has", () => {
  // Month, route, stop and day of week - the feed's own primary key. Anything
  // coarser would remove departures nobody approved removing.
  const joins = otpAssessableJoinsSql();
  for (const column of ["service_month", "route_id", "stop_id", "day_of_week"]) {
    assert.match(joins, new RegExp(`exclusion\\.${column} = otp\\.${column}`), column);
  }
  assert.match(joins, /exclusion\.status = 'approved'/);
});

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
// Migration 140 redefines the view migration 106 created, so 140 is the file
// that has to agree with this module.
const view = readFileSync(join(process.cwd(), "sql", "migration-140-otp-date-exclusion-departures.sql"), "utf8");

test("vw_OtpMonthlyRouteStop publishes this rule verbatim", () => {
  // The view is what Power BI and any future report read. If the two ever
  // disagree, the contractor can be shown two different official figures, so
  // the migration's text has to contain this expression exactly.
  assert.ok(squash(view).includes(squash(otpAssessableSql())),
    "regenerate vw_OtpMonthlyRouteStop's IsAssessable from otpAssessableSql()");
  assert.ok(squash(view).includes(squash(otpAssessableJoinsSql())),
    "regenerate vw_OtpMonthlyRouteStop's joins from otpAssessableJoinsSql()");
});

test("the view publishes the date subtraction verbatim too", () => {
  assert.ok(squash(view).includes(squash(otpDateExcludedJoinSql())),
    "regenerate the view's date-exclusion join from otpDateExcludedJoinSql()");
  for (const column of ["total", "ontime"] as const) {
    assert.ok(squash(view).includes(squash(otpAssessableCountSql(column))),
      `regenerate the view's assessable ${column} from otpAssessableCountSql("${column}")`);
  }
});

test("only an approved date subtracts, at the measurement's own grain", () => {
  const join = otpDateExcludedJoinSql();
  assert.match(join, /e\.status = 'Approved'/);
  for (const column of ["service_month", "route_id", "stop_id", "day_of_week"]) {
    assert.match(join, new RegExp(`dates\\.${column} = otp\\.${column}`), column);
  }
  // Several excluded dates can share a day of week in one month.
  assert.match(join, /SUM\(d\.total\) total/);
});

test("a date subtraction clamps at zero and never touches a row the rules already removed", () => {
  const fixedRoute = { route_category: "FixedRoute", stop_excluded: false };
  assert.equal(otpAssessableCount(fixedRoute, 100, 12), 88);
  assert.equal(otpAssessableCount(fixedRoute, 100, null), 100);
  // A monthly restatement below what was frozen must not invent departures.
  assert.equal(otpAssessableCount(fixedRoute, 10, 40), 0);
  // A row already out on the category or stop rule stays out, whatever the
  // snapshot says.
  assert.equal(otpAssessableCount({ route_category: "SpecialEvent", stop_excluded: false }, 100, 12), 0);
  assert.equal(otpAssessableCount({ route_category: "FixedRoute", stop_excluded: true }, 100, 12), 0);
});

test("Avail's own day-of-week spellings, which the join matches on", () => {
  // 2026-09-07 is the Labor Day Monday whose Sunday-level service sits in
  // September's Mon bucket - the date that showed a day could be subtracted.
  assert.equal(availDayOfWeek("20260907"), "Mon");
  assert.equal(availDayOfWeek("20260908"), "Tues");
  assert.equal(availDayOfWeek("20260910"), "Thur");
  assert.equal(availDayOfWeek("20260920"), "Sun");
  // Not "Tue"/"Thu": a near-miss spelling silently subtracts nothing.
  assert.deepEqual([...AVAIL_DAY_OF_WEEK], ["Sun", "Mon", "Tues", "Wed", "Thur", "Fri", "Sat"]);
  assert.throws(() => availDayOfWeek("2026-09-07"), TypeError);
  assert.throws(() => availDayOfWeek("20260231"), TypeError);
});

test("the month query filters by month and the trend query does not", () => {
  assert.match(otpRouteFiguresSql("month"), /WHERE otp\.service_month = @month/);
  assert.doesNotMatch(otpRouteFiguresSql("all"), /WHERE/);
  // Both group by month, so the trend can sum one month per row.
  for (const scope of ["month", "all"] as const) assert.match(otpRouteFiguresSql(scope), /GROUP BY otp\.service_month, otp\.route_id/);
});
