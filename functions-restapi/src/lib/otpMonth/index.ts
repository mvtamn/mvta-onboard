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
import { otpAssessableCountSql, otpAssessableJoinsSql, otpAssessableSql, otpDateExcludedJoinSql, otpRouteCategorySql } from "./rules";
import type { MeasureOtpMonthOptions, OtpFigure, OtpMonthMeasurement, OtpRouteFigure } from "./types";
import { requestFor as request, type Executor } from "./executor";
import { figure, routeFigures, total, type RouteRow } from "./figures";
import { readTarget } from "./target";

export * from "./types";
export * from "./rules";
export * from "./executor";
export * from "./figures";
export * from "./target";

interface Available {
  /** OtpMonthlyRouteStopDay, the feed itself (migration 014). */
  feed: boolean;
  /** OtpDateExclusions (migration 018): the dates a reviewer recorded. */
  date_exclusions: boolean;
  /**
   * OtpDateExclusionDepartures (migration 140): what an approved date took
   * out. Absent, the month measures as it did before 140 - the dates are
   * reported and nothing is subtracted.
   */
  date_departures: boolean;
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
      CASE WHEN OBJECT_ID('dbo.OtpDateExclusionDepartures','U') IS NULL THEN 0 ELSE 1 END date_departures,
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
export function otpRouteFiguresSql(scope: "month" | "all", dateExclusions = true): string {
  // Without migration 140's snapshot table there is nothing to subtract, and
  // the join would fail to bind. `dates` is then a constant-null derived table
  // so one statement serves both shapes and the expressions stay identical.
  const dates = dateExclusions
    ? otpDateExcludedJoinSql()
    : `LEFT JOIN (SELECT CAST(NULL AS CHAR(6)) service_month, CAST(NULL AS INT) route_id,
         CAST(NULL AS INT) stop_id, CAST(NULL AS NVARCHAR(20)) day_of_week,
         CAST(NULL AS INT) total, CAST(NULL AS INT) ontime) dates
  ON dates.service_month = otp.service_month
 AND dates.route_id = otp.route_id
 AND dates.stop_id = otp.stop_id
 AND dates.day_of_week = otp.day_of_week`;
  return `
    SELECT otp.service_month,
      otp.route_id,
      MAX(COALESCE(classification.route_label, otp.route_label)) route_label,
      ${otpRouteCategorySql()} route_category,
      SUM(ISNULL(otp.total,0)) raw_total,
      SUM(ISNULL(otp.ontime,0)) raw_ontime,
      SUM(CASE WHEN ${otpAssessableSql()} = 1 THEN ISNULL(otp.total,0) ELSE 0 END) before_dates_total,
      SUM(CASE WHEN ${otpAssessableSql()} = 1 THEN ISNULL(otp.ontime,0) ELSE 0 END) before_dates_ontime,
      SUM(${otpAssessableCountSql("total")}) total,
      SUM(${otpAssessableCountSql("ontime")}) ontime
    FROM dbo.OtpMonthlyRouteStopDay otp
    ${otpAssessableJoinsSql()}
    ${dates}
    ${scope === "month" ? "WHERE otp.service_month = @month" : ""}
    GROUP BY otp.service_month, otp.route_id, ${otpRouteCategorySql()}`;
}

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
      stop_excluded: empty, date_excluded: empty,
      routes: [], routes_below_target: 0,
      weather_days_recorded: 0, weather_days_applied: 0, feed_ready: false,
    };
  }

  const rows = (await request(executor).input("month", sql.Char(6), month)
    .query<RouteRow>(`${otpRouteFiguresSql("month", tables.date_departures)} ORDER BY otp.route_id`)).recordset;
  const weather = tables.date_exclusions ? await readWeatherDays(executor, month, tables) : { recorded: 0, applied: 0 };

  const routes = routeFigures(rows, target);
  return {
    service_month: month,
    target, target_source: source,
    raw: total(routes, (route) => route.raw),
    excluded: total(routes, (route) => route.excluded),
    assessable: total(routes, (route) => route.assessable),
    stop_excluded: total(routes, (route) => route.stop_excluded),
    date_excluded: total(routes, (route) => route.date_excluded),
    routes,
    routes_below_target: routes.filter((route) => route.below_target).length,
    weather_days_recorded: weather.recorded,
    weather_days_applied: weather.applied,
    feed_ready: true,
  };
}

/**
 * The month's weather and emergency dates: how many were recorded at all, and
 * how many are actually subtracting.
 *
 * The two differ for reasons a reviewer needs to see rather than infer. A
 * Proposed date has not been approved. An Approved one taken before migration
 * 140, or one whose service date the daily feed could not answer for, carries
 * no snapshot and subtracts nothing. Reporting only the applied count would
 * make a date that quietly failed to apply look like a date nobody entered.
 */
async function readWeatherDays(executor: Executor, month: string, tables: Available): Promise<{ recorded: number; applied: number }> {
  const req = request(executor).input("month", sql.Char(6), month);
  // The snapshot is reached by join, not by EXISTS inside the SUM: SQL Server
  // refuses an aggregate over an expression containing a subquery.
  const row = (await req.query<{ recorded: number; applied: number }>(`
    SELECT COUNT(*) recorded,
      SUM(CASE WHEN e.status = 'Approved' AND ${tables.date_departures ? "snapshot.exclusion_id IS NOT NULL" : "1 = 0"} THEN 1 ELSE 0 END) applied
    FROM dbo.OtpDateExclusions e
    ${tables.date_departures
      ? "LEFT JOIN (SELECT DISTINCT exclusion_id FROM dbo.OtpDateExclusionDepartures) snapshot ON snapshot.exclusion_id = e.id"
      : ""}
    WHERE LEFT(e.service_date,6) = @month
  `)).recordset[0];
  return { recorded: Number(row?.recorded ?? 0), applied: Number(row?.applied ?? 0) };
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
    FROM (${otpRouteFiguresSql("all", tables.date_departures)}) monthly
    GROUP BY service_month
    ORDER BY service_month DESC`)).recordset;
  return rows.map((row) => ({
    service_month: row.service_month,
    raw: figure(Number(row.raw_total), Number(row.raw_ontime)),
    assessable: figure(Number(row.total), Number(row.ontime)),
  })).reverse();
}
