// Whether migration 102's agreement scoping is present in this database.
//
// The application ships ahead of its migrations: merging deploys the code, and
// applying the schema is a separate manual step against a server whose public
// access is closed by default. Between those two moments the code has to keep
// working, which means it cannot reference AgreementStandards or
// ContractorStandardTiers.agreement_id unconditionally - an unknown object or
// column fails at parse time, taking the whole batch with it, and no runtime
// check inside the same batch can prevent that. So the check happens first, in
// TypeScript, and the SQL is composed from the answer.
//
// Before migration 102 the behaviour is exactly what it was before this
// feature existed: every standard the agency scores applies to every
// agreement, and tier ladders have no agreement dimension. After it, the
// agreement decides. Neither path is a degraded guess - the pre-102 answer is
// simply the only one the schema can express.
import type { ConnectionPool, Transaction } from "mssql";
import { sql } from "../db";

export interface AgreementScope {
  /** migration 102 has run: assignments and tier overrides are available. */
  scoped: boolean;
  /** migration 103 has run: the period snapshot carries the resolver that measured it. */
  snapshotsResolver: boolean;
  /** migration 107 has run: targets, count-scaled bands, ranged amounts and CAP windows. */
  penaltyScaling: boolean;
  /** migration 109 has run: a window says whether it is rolling days or a calendar quarter. */
  windowModes: boolean;
  /** migration 105 has run: the period's tier snapshot carries its ranking. */
  snapshotsSeverity: boolean;
}

const SCOPE_QUERY = `
    SELECT CONVERT(int, CASE
      WHEN OBJECT_ID('dbo.AgreementStandards','U') IS NOT NULL
       AND COL_LENGTH('dbo.ContractorStandardTiers','agreement_id') IS NOT NULL
      THEN 1 ELSE 0 END) scoped,
      CONVERT(int, CASE WHEN COL_LENGTH('dbo.AssessmentPeriodStandards','resolver_key') IS NULL THEN 0 ELSE 1 END) snapshots_resolver,
      CONVERT(int, CASE WHEN COL_LENGTH('dbo.ComplianceOccurrences','assessed_amount') IS NULL
                          OR COL_LENGTH('dbo.AssessmentPeriodStandards','target_value') IS NULL THEN 0 ELSE 1 END) penalty_scaling,
      CONVERT(int, CASE WHEN COL_LENGTH('dbo.AssessmentPeriodTiers','severity_order') IS NULL THEN 0 ELSE 1 END) snapshots_severity,
      CONVERT(int, CASE WHEN COL_LENGTH('dbo.AssessmentPeriodStandards','cap_window_mode') IS NULL THEN 0 ELSE 1 END) window_modes
`;

interface ScopeRow { scoped: number; snapshots_resolver: number; penalty_scaling: number; snapshots_severity: number; window_modes: number }

function toScope(row: ScopeRow | undefined): AgreementScope {
  return {
    scoped: row?.scoped === 1,
    snapshotsResolver: row?.snapshots_resolver === 1,
    penaltyScaling: row?.penalty_scaling === 1,
    snapshotsSeverity: row?.snapshots_severity === 1,
    windowModes: row?.window_modes === 1,
  };
}

export async function agreementScope(pool: ConnectionPool): Promise<AgreementScope> {
  const result = await pool.request().query<ScopeRow>(SCOPE_QUERY);
  return toScope(result.recordset[0]);
}

// The same question from inside a transaction. assessPeriod already holds one
// and must not open a second connection to ask, or the check would read a
// different session's view of the schema mid-compute.
export async function agreementScopeIn(tx: Transaction): Promise<AgreementScope> {
  const result = await new sql.Request(tx).query<ScopeRow>(SCOPE_QUERY);
  return toScope(result.recordset[0]);
}

// The resolver column the period snapshot carries, or the catalog's own value
// when migration 103 has not run yet. Falling back to the catalog is a
// behaviour change only in the window before the migration, and it matches
// what the compute did when it ignored resolver_key entirely.
export function periodResolverKeySql(scope: AgreementScope): string {
  return scope.snapshotsResolver
    ? "resolver_key"
    : "(SELECT c.resolver_key FROM ContractorPerformanceStandards c WHERE c.id=AssessmentPeriodStandards.standard_id) resolver_key";
}

// How many standards this agreement scores for the month. Pre-102 there is no
// per-agreement answer, so it counts the catalog's scored standards - the set
// the snapshot would take, which is what the caller is really asking about.
export function assignedStandardCountSql(scope: AgreementScope): string {
  return scope.scoped
    ? `(SELECT COUNT(*) FROM AgreementStandards ags
         WHERE ags.agreement_id=a.id AND ags.is_scored=1
           AND ags.effective_start_date<=CONCAT(@month,'01')
           AND (ags.effective_end_date IS NULL OR ags.effective_end_date>=CONCAT(@month,'01')))`
    : `(SELECT COUNT(*) FROM ContractorPerformanceStandards WHERE is_scored=1)`;
}

// Which standards the period snapshots.
export function periodStandardSourceSql(scope: AgreementScope): string {
  return scope.scoped
    ? `FROM ContractorPerformanceStandards s
       JOIN AgreementStandards ags ON ags.standard_id=s.id AND ags.agreement_id=@agreement
       WHERE ags.is_scored=1 AND ags.effective_start_date<=CONCAT(@month,'01')
         AND (ags.effective_end_date IS NULL OR ags.effective_end_date>=CONCAT(@month,'01'))`
    : `FROM ContractorPerformanceStandards s WHERE s.is_scored=1`;
}

// Tier precedence: an agreement's own tier rows govern the whole ladder for a
// standard, or none of it - blending an override with catalog defaults would
// produce bands nobody wrote. Pre-102 every row is a catalog default, so the
// clause collapses to the effective-date filter alone.
export function periodTierScopeSql(scope: AgreementScope): string {
  return scope.scoped
    ? `AND (t.agreement_id=@agreement OR (t.agreement_id IS NULL AND NOT EXISTS(
         SELECT 1 FROM ContractorStandardTiers o
         WHERE o.standard_id=t.standard_id AND o.agreement_id=@agreement
           AND o.effective_start_date<=CONCAT(@month,'01')
           AND (o.effective_end_date IS NULL OR o.effective_end_date>=CONCAT(@month,'01')))))`
    : "";
}

// The columns migration 107 adds. Absent, the compute behaves exactly as it did
// before: no target on the report, bands matched per occurrence, no ranged
// amounts and no rolling windows.
export function periodStandardScalingSql(scope: AgreementScope): string {
  return scope.penaltyScaling
    ? `target_value,target_display,band_scope,cap_window_days,cap_window_threshold,${scope.windowModes ? "cap_window_mode" : "CONVERT(nvarchar(20),NULL) cap_window_mode"}`
    : "CONVERT(float,NULL) target_value,CONVERT(nvarchar(100),NULL) target_display," +
      "CONVERT(nvarchar(20),NULL) band_scope,CONVERT(int,NULL) cap_window_days,CONVERT(int,NULL) cap_window_threshold," +
      "CONVERT(nvarchar(20),NULL) cap_window_mode";
}

export function periodTierScalingSql(scope: AgreementScope): string {
  return scope.penaltyScaling
    ? "penalty_amount_min,penalty_amount_max"
    : "CONVERT(decimal(12,2),NULL) penalty_amount_min,CONVERT(decimal(12,2),NULL) penalty_amount_max";
}

// The tier snapshot's columns, named explicitly.
//
// This insert used to have no column list at all, which made it depend on the
// physical column order of AssessmentPeriodTiers - so the first migration to
// add a column to that table (105's severity_order) would have failed every
// attempt to open a period with a column-count mismatch. Naming them means a
// later column is inert here until this list says otherwise.
export function periodTierSnapshotColumns(scope: AgreementScope): { columns: string; select: string } {
  const columns = ["period_id", "standard_id", "tier_order", "tier_label", "bound_low", "bound_high",
    "qualifier_code", "penalty_basis", "penalty_amount", "triggers_cap"];
  const select = ["@period", "t.standard_id", "t.tier_order", "t.tier_label", "t.bound_low", "t.bound_high",
    "t.qualifier_code", "t.penalty_basis", "t.penalty_amount", "t.triggers_cap"];
  if (scope.snapshotsSeverity) {
    columns.push("severity_order");
    // Ranking lives in ReferenceValues; a label with no row there ranks null
    // and tierSeverity falls back to the built-in order.
    select.push("(SELECT TOP 1 rv.severity_order FROM ReferenceValues rv WHERE rv.domain='tier_label' AND rv.value=t.tier_label)");
  }
  if (scope.penaltyScaling) {
    columns.push("penalty_amount_min", "penalty_amount_max");
    select.push("t.penalty_amount_min", "t.penalty_amount_max");
  }
  return { columns: columns.join(","), select: select.join(",") };
}

// The same list for the reopen path, which copies a previous snapshot forward
// rather than re-reading the catalog.
export function periodTierCopyColumns(scope: AgreementScope): string {
  const columns = ["standard_id", "tier_order", "tier_label", "bound_low", "bound_high",
    "qualifier_code", "penalty_basis", "penalty_amount", "triggers_cap"];
  if (scope.snapshotsSeverity) columns.push("severity_order");
  if (scope.penaltyScaling) columns.push("penalty_amount_min", "penalty_amount_max");
  return columns.join(",");
}

export function periodStandardSnapshotColumns(scope: AgreementScope): string {
  const columns = ["code", "name", "standard_type", "priority", "direction", "is_safety_critical",
    "measurement_source", "sort_order"];
  if (scope.snapshotsResolver) columns.push("resolver_key");
  if (scope.penaltyScaling) columns.push("target_value", "target_display", "band_scope", "cap_window_days", "cap_window_threshold");
  if (scope.windowModes) columns.push("cap_window_mode");
  return columns.join(",");
}
