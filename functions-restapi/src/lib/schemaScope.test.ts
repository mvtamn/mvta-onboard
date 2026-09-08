import { test } from "node:test";
import assert from "node:assert";
import {
  assignedStandardCountSql, periodResolverKeySql, periodStandardSnapshotColumns, periodStandardSourceSql,
  periodTierCopyColumns, periodTierScopeSql, periodTierSnapshotColumns,
} from "./assessment/schemaScope";

// The application deploys on merge; migration 102 is a separate manual step
// against a server whose public access is closed by default. Between those two
// moments every one of these has to compose SQL the older schema can parse -
// an unknown object or column fails at parse time and takes the whole batch
// with it, so no runtime guard inside the SQL could save it.
const scoped = { scoped: true, snapshotsResolver: true, penaltyScaling: true, snapshotsSeverity: true, windowModes: true };
const unscoped = { scoped: false, snapshotsResolver: false, penaltyScaling: false, snapshotsSeverity: false, windowModes: false };

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

test("before migration 103 the resolver comes from the catalog, not the snapshot", () => {
  // AssessmentPeriodStandards.resolver_key does not exist yet, so naming it
  // would fail the whole batch at parse time.
  const sql = periodResolverKeySql({ ...scoped, snapshotsResolver: false });
  assert.ok(!/^resolver_key$/.test(sql));
  assert.ok(sql.includes("FROM ContractorPerformanceStandards"));
});

test("after migration 103 the period's own snapshot decides how it was measured", () => {
  // The point of snapshotting it: repointing a standard at a different
  // resolver must not change how an already-issued month recomputes.
  assert.strictEqual(periodResolverKeySql({ ...scoped }), "resolver_key");
});

test("the tier snapshot names its columns, so a new column cannot break the insert", () => {
  // This insert had no column list, so it depended on the physical column
  // order of AssessmentPeriodTiers - and migration 105's severity_order would
  // then have failed every attempt to open a period on a column-count
  // mismatch. Naming them makes a later column inert until this list says so.
  const before = periodTierSnapshotColumns({ ...unscoped });
  assert.ok(!before.columns.includes("severity_order"));
  assert.ok(!before.columns.includes("penalty_amount_min"));
  assert.strictEqual(before.columns.split(",").length, before.select.split(",").length);

  const after = periodTierSnapshotColumns({ ...scoped });
  assert.ok(after.columns.includes("severity_order"));
  assert.ok(after.columns.includes("penalty_amount_min"));
  assert.strictEqual(after.columns.split(",").length, after.select.split(",").length);
});

test("the reopen copy carries exactly what the snapshot holds", () => {
  // A column dropped here is silently lost when a period is reopened - which
  // is how a reopened month could have scored against a different ladder.
  assert.ok(periodTierCopyColumns({ ...scoped }).includes("severity_order"));
  assert.ok(periodTierCopyColumns({ ...scoped }).includes("penalty_amount_max"));
  assert.ok(!periodTierCopyColumns({ ...unscoped }).includes("severity_order"));
});

test("the standard snapshot carries the target only once migration 107 has run", () => {
  assert.ok(!periodStandardSnapshotColumns({ ...unscoped }).includes("target_value"));
  assert.ok(periodStandardSnapshotColumns({ ...scoped }).includes("target_value"));
  assert.ok(periodStandardSnapshotColumns({ ...scoped }).includes("cap_window_days"));
});
