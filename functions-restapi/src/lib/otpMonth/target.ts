// Where a month's OTP target comes from.
//
// Two sources, in order. A month with ONE Assessment Period is judged by that
// period's frozen rules (ADR 0006), so a band edited later cannot restate a
// month already finalized. Otherwise the current catalog answers, and the
// measurement says which of the two it used.
//
// This asks five tables belonging to the assessment domain - periods, their
// standards and tiers, the catalog and its tiers - which is why it is its own
// file rather than more lines inside measureOtpMonth. measureOtpMonth still
// calls it: the whole point of ADR 0033 is that one place answers what a month
// scored, so the target is not something a caller gets to supply.
import { sql } from "../db";
import type { Executor } from "./executor";
import { requestFor } from "./executor";
import type { OtpTargetSource } from "./types";

export const OTP_STANDARD_CODE = "OTP_FIXED_ROUTE";

// Used only where nothing else answers: no Assessment Period, no catalog band.
// It is Attachment G's figure, and the same number the console used to
// hardcode in two places.
export const DEFAULT_OTP_TARGET = 0.85;

export interface TargetTables {
  periods: boolean;
  period_target: boolean;
  catalog: boolean;
  catalog_target: boolean;
}

export interface ResolvedTarget {
  target: number;
  source: OtpTargetSource;
}

/** A target row as either source returns it: an explicit value, or the band. */
export interface TargetRow {
  target_value: number | null;
  bound_low: number | null;
}

/**
 * Which target a set of frozen period rows yields.
 *
 * Exactly one row means one Assessment Period covers the month, and its rules
 * decide. Several rows mean several periods - several contractors - and no
 * caller said which, so none of them may answer: putting one contractor's
 * negotiated target on another's figure would be worse than falling back to
 * the catalog. None means the month has no period at all.
 *
 * Returns null wherever the caller should go on to the next source.
 */
export function frozenTarget(rows: readonly TargetRow[]): number | null {
  if (rows.length !== 1) return null;
  return usableTarget(rows[0]);
}

/** A row's target: the explicit value, else the "meets" band's lower bound. */
export function usableTarget(row: TargetRow | undefined): number | null {
  const value = row?.target_value ?? row?.bound_low ?? null;
  return value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
}

/** The target a month is judged against, and where it came from. */
export async function readTarget(
  executor: Executor,
  month: string,
  tables: TargetTables,
  periodId?: string | null,
): Promise<ResolvedTarget> {
  if (tables.periods) {
    const frozen = requestFor(executor);
    frozen.input("month", sql.Char(6), month);
    frozen.input("period", sql.UniqueIdentifier, periodId ?? null);
    const rows = (await frozen.query<TargetRow>(`
      SELECT TOP 2 ${tables.period_target ? "ps.target_value" : "CAST(NULL AS FLOAT) target_value"}, t.bound_low
      FROM dbo.AssessmentPeriods p
      JOIN dbo.AssessmentPeriodStandards ps ON ps.period_id = p.id AND ps.code = '${OTP_STANDARD_CODE}'
      LEFT JOIN dbo.AssessmentPeriodTiers t ON t.period_id = ps.period_id AND t.standard_id = ps.standard_id AND t.tier_label = 'meets'
      WHERE p.service_month = @month AND (@period IS NULL OR p.id = @period)
    `)).recordset;
    const target = frozenTarget(rows);
    if (target !== null) return { target, source: "period_rule_set" };
  }

  if (tables.catalog) {
    const catalog = requestFor(executor);
    catalog.input("date", sql.Char(8), `${month}01`);
    const row = (await catalog.query<TargetRow>(`
      SELECT TOP 1 ${tables.catalog_target ? "s.target_value" : "CAST(NULL AS FLOAT) target_value"}, t.bound_low
      FROM dbo.ContractorPerformanceStandards s
      LEFT JOIN dbo.ContractorStandardTiers t ON t.standard_id = s.id AND t.tier_label = 'meets'
        AND t.effective_start_date <= @date AND (t.effective_end_date IS NULL OR t.effective_end_date >= @date)
      WHERE s.code = '${OTP_STANDARD_CODE}'
      ORDER BY t.effective_start_date DESC
    `)).recordset[0];
    const target = usableTarget(row);
    if (target !== null) return { target, source: "catalog" };
  }

  return { target: DEFAULT_OTP_TARGET, source: "default" };
}
