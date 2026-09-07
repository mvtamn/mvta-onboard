import { test } from "node:test";
import assert from "node:assert";
import {
  assignedStandardCountSql, periodStandardSourceSql, periodTierScopeSql,
} from "./assessment/schemaScope";

// The application deploys on merge; migration 102 is a separate manual step
// against a server whose public access is closed by default. Between those two
// moments every one of these has to compose SQL the older schema can parse -
// an unknown object or column fails at parse time and takes the whole batch
// with it, so no runtime guard inside the SQL could save it.
const scoped = { scoped: true };
const unscoped = { scoped: false };

test("before migration 102 nothing names AgreementStandards", () => {
  for (const sql of [assignedStandardCountSql(unscoped), periodStandardSourceSql(unscoped), periodTierScopeSql(unscoped)]) {
    assert.ok(!sql.includes("AgreementStandards"), `pre-102 SQL must not reference the table: ${sql}`);
  }
});

test("before migration 102 nothing names the tier table's agreement_id", () => {
  for (const sql of [assignedStandardCountSql(unscoped), periodStandardSourceSql(unscoped), periodTierScopeSql(unscoped)]) {
    assert.ok(!sql.includes("agreement_id"), `pre-102 SQL must not reference the column: ${sql}`);
  }
});

test("after migration 102 the agreement decides which standards are scored", () => {
  assert.ok(assignedStandardCountSql(scoped).includes("AgreementStandards"));
  assert.ok(periodStandardSourceSql(scoped).includes("JOIN AgreementStandards"));
});

test("before migration 102 the period snapshots the agency catalog, as it always did", () => {
  // Not a degraded guess - it is the only answer the older schema can express,
  // and it is exactly what assessmentPeriods.ts did before this feature.
  const source = periodStandardSourceSql(unscoped);
  assert.ok(source.includes("FROM ContractorPerformanceStandards s"));
  assert.ok(source.includes("WHERE s.is_scored=1"));
});

test("before migration 102 the tier scope clause is empty, not a false filter", () => {
  // An empty string leaves the effective-date filter alone. Anything else
  // would silently drop bands from a period that should have scored them.
  assert.strictEqual(periodTierScopeSql(unscoped), "");
});

test("after migration 102 an agreement's ladder replaces the catalog's entirely", () => {
  const clause = periodTierScopeSql(scoped);
  assert.ok(clause.includes("t.agreement_id=@agreement"));
  // The NOT EXISTS is what makes an override all-or-nothing: a catalog default
  // is taken only when the agreement has no row for that standard at all.
  assert.ok(clause.includes("NOT EXISTS"));
  assert.ok(clause.includes("t.agreement_id IS NULL"));
});

test("the assigned-standard count falls back to the catalog's scored set", () => {
  assert.ok(assignedStandardCountSql(unscoped).includes("ContractorPerformanceStandards WHERE is_scored=1"));
});
