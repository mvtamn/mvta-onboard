// The OTP month measurement module. It answers one question - what was
// fixed-route on-time performance for this service month - and every reader
// asks it here: the assessment resolver, GET /otp-monthly, the trend, the
// reporting view (through the shared SQL in rules.ts) and the console.
//
// Before this, five places answered it differently: the resolver filtered to
// fixed route and removed approved stop exclusions, the view repeated that
// rule as a column, the two handlers did neither, and the browser recomputed
// its own "official" figure from rows it had flagged itself. The Dashboard's
// "Routes below target · Official departure OTP" card counted raw routes.
import { sql } from "../db";
import { otpAssessableJoinsSql, otpAssessableSql, otpRouteCategorySql } from "./rules";
import type { MeasureOtpMonthOptions, OtpFigure, OtpMonthMeasurement, OtpRouteFigure, OtpTargetSource } from "./types";

export * from "./types";
export * from "./rules";

export const OTP_STANDARD_CODE = "OTP_FIXED_ROUTE";

// Used only where nothing else answers: no Assessment Period, no catalog band.
// It is Attachment G's figure, and the same number the console used to
// hardcode in two places.
export const DEFAULT_OTP_TARGET = 0.85;

type Executor = sql.ConnectionPool | sql.Transaction;
const request = (executor: Executor) => executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

const figure = (departures: number, ontime: number): OtpFigure => ({
  departures,
  ontime,
  pct: departures > 0 ? ontime / departures : null,
});

interface RouteRow {
  service_month: string;
  route_id: number;
  route_label: string | null;
  route_category: string;
  raw_total: number;
  raw_ontime: number;
  total: number;
  ontime: number;
}

interface Available {
  /** OtpMonthlyRouteStopDay, the feed itself (migration 014). */
  feed: boolean;
  /** OtpDateExclusions (migration 018): counted, never applied. */
  date_exclusions: boolean;
  /** The assessment tables a frozen target comes from. */
  periods: boolean;
  period_target: boolean;
  catalog: boolean;
  catalog_target: boolean;
}

async function available(executor: Executor): Promise<Available> {
  const row = (await request(executor).query<Record<string, number>>(`
    SELECT
      CASE WHEN OBJECT_ID('dbo.OtpMonthlyRouteStopDay','U') IS NULL
        OR OBJECT_ID('dbo.RouteClassification','U') IS NULL
        OR OBJECT_ID('dbo.OtpStopExclusions','U') IS NULL THEN 0 ELSE 1 END feed,
      CASE WHEN OBJECT_ID('dbo.OtpDateExclusions','U') IS NULL THEN 0 ELSE 1 END date_exclusions,
      CASE WHEN OBJECT_ID('dbo.AssessmentPeriods','U') IS NULL
        OR OBJECT_ID('dbo.AssessmentPeriodStandards','U') IS NULL
        OR OBJECT_ID('dbo.AssessmentPeriodTiers','U') IS NULL THEN 0 ELSE 1 END periods,
      CASE WHEN COL_LENGTH('dbo.AssessmentPeriodStandards','target_value') IS NULL THEN 0 ELSE 1 END period_target,
      CASE WHEN OBJECT_ID('dbo.ContractorPerformanceStandards','U') IS NULL
        OR OBJECT_ID('dbo.ContractorStandardTiers','U') IS NULL THEN 0 ELSE 1 END catalog,
      CASE WHEN COL_LENGTH('dbo.ContractorPerformanceStandards','target_value') IS NULL THEN 0 ELSE 1 END catalog_target
  `)).recordset[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === 1])) as unknown as Available;
}

/**
 * Per-route figures from the feed, raw and assessable, for one month
 * (`scope: "month"`, filtered by @month) or every month at once
 * (`scope: "all"`, for the trend). One statement, one rule: the assessable
 * test and its joins come from rules.ts, which the reporting view also uses.
 */
export function otpRouteFiguresSql(scope: "month" | "all"): string {
  return `
    SELECT otp.service_month,
      otp.route_id,
      MAX(COALESCE(classification.route_label, otp.route_label)) route_label,
      ${otpRouteCategorySql()} route_category,
      SUM(ISNULL(otp.total,0)) raw_total,
      SUM(ISNULL(otp.ontime,0)) raw_ontime,
      SUM(CASE WHEN ${otpAssessableSql()} = 1 THEN ISNULL(otp.total,0) ELSE 0 END) total,
      SUM(CASE WHEN ${otpAssessableSql()} = 1 THEN ISNULL(otp.ontime,0) ELSE 0 END) ontime
    FROM dbo.OtpMonthlyRouteStopDay otp
    ${otpAssessableJoinsSql()}
    ${scope === "month" ? "WHERE otp.service_month = @month" : ""}
    GROUP BY otp.service_month, otp.route_id, ${otpRouteCategorySql()}`;
}

async function readTarget(executor: Executor, month: string, tables: Available, periodId?: string | null): Promise<{ target: number; source: OtpTargetSource }> {
  if (tables.periods) {
    const frozen = request(executor);
    frozen.input("month", sql.Char(6), month);
    frozen.input("period", sql.UniqueIdentifier, periodId ?? null);
    // A month with one Assessment Period is judged by that period's frozen
    // rules (ADR 0006), so a band edited later cannot restate a finalized
    // month. Several periods - several contractors - and no caller to say
    // which: the catalog answers, because guessing here would put one
    // contractor's negotiated target on another's figure.
    const rows = (await frozen.query<{ target_value: number | null; bound_low: number | null }>(`
      SELECT TOP 2 ${tables.period_target ? "ps.target_value" : "CAST(NULL AS FLOAT) target_value"}, t.bound_low
      FROM dbo.AssessmentPeriods p
      JOIN dbo.AssessmentPeriodStandards ps ON ps.period_id = p.id AND ps.code = '${OTP_STANDARD_CODE}'
      LEFT JOIN dbo.AssessmentPeriodTiers t ON t.period_id = ps.period_id AND t.standard_id = ps.standard_id AND t.tier_label = 'meets'
      WHERE p.service_month = @month AND (@period IS NULL OR p.id = @period)
    `)).recordset;
    const target = rows.length === 1 ? rows[0].target_value ?? rows[0].bound_low : null;
    if (target !== null && Number.isFinite(target)) return { target: Number(target), source: "period_rule_set" };
  }
  if (tables.catalog) {
    const catalog = request(executor);
    catalog.input("date", sql.Char(8), `${month}01`);
    const row = (await catalog.query<{ target_value: number | null; bound_low: number | null }>(`
      SELECT TOP 1 ${tables.catalog_target ? "s.target_value" : "CAST(NULL AS FLOAT) target_value"}, t.bound_low
      FROM dbo.ContractorPerformanceStandards s
      LEFT JOIN dbo.ContractorStandardTiers t ON t.standard_id = s.id AND t.tier_label = 'meets'
        AND t.effective_start_date <= @date AND (t.effective_end_date IS NULL OR t.effective_end_date >= @date)
      WHERE s.code = '${OTP_STANDARD_CODE}'
      ORDER BY t.effective_start_date DESC
    `)).recordset[0];
    const target = row?.target_value ?? row?.bound_low ?? null;
    if (target !== null && Number.isFinite(target)) return { target: Number(target), source: "catalog" };
  }
  return { target: DEFAULT_OTP_TARGET, source: "default" };
}

function routeFigures(rows: RouteRow[], target: number): OtpRouteFigure[] {
  return rows.map((row) => {
    const raw = figure(Number(row.raw_total), Number(row.raw_ontime));
    const assessable = figure(Number(row.total), Number(row.ontime));
    const excluded = figure(raw.departures - assessable.departures, raw.ontime - assessable.ontime);
    return {
      route_id: row.route_id,
      route_label: row.route_label,
      route_category: row.route_category,
      raw, excluded, assessable,
      below_target: assessable.pct === null ? null : assessable.pct < target,
    };
  });
}

const total = (routes: OtpRouteFigure[], pick: (route: OtpRouteFigure) => OtpFigure) => figure(
  routes.reduce((sum, route) => sum + pick(route).departures, 0),
  routes.reduce((sum, route) => sum + pick(route).ontime, 0),
);

/**
 * Fixed-route OTP for one service month: raw, excluded and assessable, agency
 * and per route, with the target the month is judged against.
 */
export async function measureOtpMonth(executor: Executor, month: string, options: MeasureOtpMonthOptions = {}): Promise<OtpMonthMeasurement> {
  const tables = await available(executor);
  const { target, source } = await readTarget(executor, month, tables, options.periodId);
  const empty = figure(0, 0);
  if (!tables.feed) {
    return {
      service_month: month, target, target_source: source,
      raw: empty, excluded: empty, assessable: empty,
      routes: [], routes_below_target: 0, weather_days_recorded: 0, feed_ready: false,
    };
  }

  const rows = (await request(executor).input("month", sql.Char(6), month)
    .query<RouteRow>(`${otpRouteFiguresSql("month")} ORDER BY otp.route_id`)).recordset;
  // Recorded, never applied: the monthly feed is keyed by day of week, not
  // date, so a single weather date cannot be taken out of it (ADR 0033).
  const weather = tables.date_exclusions
    ? Number((await request(executor).input("month", sql.Char(6), month).query<{ n: number }>(
      `SELECT COUNT(*) n FROM dbo.OtpDateExclusions WHERE LEFT(service_date,6) = @month AND status = 'Approved'`)).recordset[0]?.n ?? 0)
    : 0;

  const routes = routeFigures(rows, target);
  return {
    service_month: month,
    target, target_source: source,
    raw: total(routes, (route) => route.raw),
    excluded: total(routes, (route) => route.excluded),
    assessable: total(routes, (route) => route.assessable),
    routes,
    routes_below_target: routes.filter((route) => route.below_target).length,
    weather_days_recorded: weather,
    feed_ready: true,
  };
}

export interface OtpTrendMonth {
  service_month: string;
  raw: OtpFigure;
  assessable: OtpFigure;
}

/**
 * The agency figure per month for the Dashboard trend, oldest first. The
 * chart plots the assessable figure - the one the scorecard shows - so the two
 * stop disagreeing; raw travels with it, because a reader comparing them is
 * entitled to see what came out.
 */
export async function measureOtpTrend(executor: Executor, months: number): Promise<OtpTrendMonth[]> {
  const tables = await available(executor);
  if (!tables.feed) return [];
  const rows = (await request(executor).input("months", sql.Int, months).query<{
    service_month: string; raw_total: number; raw_ontime: number; total: number; ontime: number;
  }>(`
    SELECT TOP (@months) service_month,
      SUM(raw_total) raw_total, SUM(raw_ontime) raw_ontime, SUM(total) total, SUM(ontime) ontime
    FROM (${otpRouteFiguresSql("all")}) monthly
    GROUP BY service_month
    ORDER BY service_month DESC`)).recordset;
  return rows.map((row) => ({
    service_month: row.service_month,
    raw: figure(Number(row.raw_total), Number(row.raw_ontime)),
    assessable: figure(Number(row.total), Number(row.ontime)),
  })).reverse();
}
