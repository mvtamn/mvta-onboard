import assert from "node:assert/strict";
import test from "node:test";
import { dateExclusionAuditSql, stopExclusionAuditSql } from "./otpAuditStream";

// The Audit Stream's "Current month only" checkbox sends ?month=. It reached
// the stop exclusions and not the weather days, so the stream kept showing
// every weather day ever recorded while claiming to be scoped to one month.
test("scoping to a month reaches both kinds of exclusion", () => {
  assert.match(stopExclusionAuditSql("202609"), /WHERE service_month = @service_month/);
  assert.match(dateExclusionAuditSql("202609"), /WHERE LEFT\(service_date, 6\) = @service_month/);
});

test("without a month neither query is filtered", () => {
  assert.equal(/WHERE/.test(stopExclusionAuditSql(null)), false);
  assert.equal(/WHERE/.test(dateExclusionAuditSql(null)), false);
});

// A Weather Day Exclusion belongs to the month its service date falls in.
// service_date is CHAR(8) 'YYYYMMDD', so the month is its first six
// characters - not a date range, and not created_at, which is when somebody
// typed it in and can be a different month entirely.
test("a weather day is scoped by the date it happened, not when it was logged", () => {
  const query = dateExclusionAuditSql("202609");
  assert.match(query, /LEFT\(service_date, 6\)/);
  assert.equal(/created_at = @service_month/.test(query), false);
});

// The limit used to be a slice taken in memory after reading both tables
// entire, so OtpDateExclusions was read unbounded on every call.
test("both queries are bounded and ordered newest first in SQL", () => {
  for (const month of ["202609", null]) {
    assert.match(stopExclusionAuditSql(month), /SELECT TOP \(@limit\)/);
    assert.match(stopExclusionAuditSql(month), /ORDER BY reviewed_at DESC/);
    assert.match(dateExclusionAuditSql(month), /SELECT TOP \(@limit\)/);
    assert.match(dateExclusionAuditSql(month), /ORDER BY created_at DESC/);
  }
});

// Each table is ordered by its own recorded time: a stop exclusion carries
// reviewed_at, a weather day created_at. Sorting one by the other's column
// would not compile in SQL and would silently order by nothing here.
test("each query orders by the column its own table has", () => {
  assert.equal(/created_at/.test(stopExclusionAuditSql(null)), false);
  assert.equal(/reviewed_at/.test(dateExclusionAuditSql(null)), false);
});
