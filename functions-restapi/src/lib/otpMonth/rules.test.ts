import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { isOtpRowAssessable, otpAssessableJoinsSql, otpAssessableSql, otpRouteCategorySql } from "./rules";
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

test("vw_OtpMonthlyRouteStop publishes this rule verbatim", () => {
  // The view is what Power BI and any future report read. If the two ever
  // disagree, the contractor can be shown two different official figures, so
  // the migration's text has to contain this expression exactly.
  const squash = (text: string) => text.replace(/\s+/g, " ").trim();
  const migration = readFileSync(join(process.cwd(), "sql", "migration-106-raw-measurement-reporting-views.sql"), "utf8");
  assert.ok(squash(migration).includes(squash(otpAssessableSql())),
    "regenerate vw_OtpMonthlyRouteStop's IsAssessable from otpAssessableSql()");
  assert.ok(squash(migration).includes(squash(otpAssessableJoinsSql())),
    "regenerate vw_OtpMonthlyRouteStop's joins from otpAssessableJoinsSql()");
});

test("the month query filters by month and the trend query does not", () => {
  assert.match(otpRouteFiguresSql("month"), /WHERE otp\.service_month = @month/);
  assert.doesNotMatch(otpRouteFiguresSql("all"), /WHERE/);
  // Both group by month, so the trend can sum one month per row.
  for (const scope of ["month", "all"] as const) assert.match(otpRouteFiguresSql(scope), /GROUP BY otp\.service_month, otp\.route_id/);
});
