// Which stops a reviewer is asked to look at, decided once, here.
//
// A Flagged Stop is a stop, on one route, on one day of the week, whose early
// or late share of departures exceeds the Early/Late Bias Threshold for a
// service month (CONTEXT "Flagged Stop"). Being flagged decides nothing - the
// row still counts toward Official Departure OTP exactly as before unless a
// reviewer turns it into an approved Stop Exclusion.
//
// This is deliberately NOT part of lib/otpMonth. That module answers what the
// month scored, which is a contractual question changed by amendment. This one
// answers who gets looked at, which is an operational heuristic with a knob an
// administrator can move in Administration > OTP Compliance. Folding the two
// together would mean a slider could appear to restate a finalized month.
//
// The browser used to decide this, over every stop row the API shipped it, at
// a default of its own - the same split ADR 0033 closed for the official
// figure, one step earlier in the pipeline (ADR 0034).
import { sql } from "./db";
import { FIXED_ROUTE_CATEGORY, otpRouteCategorySql } from "./otpMonth/rules";
import type { Executor } from "./otpMonth";

/**
 * The share of departures above which early or late running flags a stop.
 *
 * The one default in code. `OtpSettings.early_late_bias_threshold` is the real
 * value and an administrator owns it; this answers only when that table or row
 * is missing. A clear, obvious flag point rather than a tuned statistical
 * model - the same convention as SpeedAlerts' fixed 50 mph.
 */
export const DEFAULT_EARLY_LATE_BIAS_THRESHOLD = 0.15;

/** A row as the feed holds it, with the category it is measured under. */
export interface FlaggableStopRow {
  route_id: number;
  route_label: string | null;
  stop_id: number;
  stop_name: string | null;
  day_of_week: string;
  /** RouteClassification.route_category, or null when the route has no row. */
  route_category: string | null;
  total: number | null;
  pct_early: number | null;
  pct_ontime: number | null;
  pct_late: number | null;
  pct_missed: number | null;
}

/** A stop put in front of a reviewer. Shares are 0-1, as the feed stores them. */
export interface FlaggedStop {
  route_id: number;
  route_label: string | null;
  stop_id: number;
  stop_name: string | null;
  day_of_week: string;
  total: number;
  pct_early: number;
  pct_ontime: number;
  pct_late: number;
  pct_missed: number;
}

const share = (value: number | null): number => value ?? 0;

/** How far the row leans, either way - what the threshold is compared against. */
export function stopBias(row: FlaggableStopRow): number {
  return Math.max(share(row.pct_early), share(row.pct_late));
}

/**
 * Whether one row is a Flagged Stop at `threshold`.
 *
 * Only fixed-route service is flagged: excluding a stop on a special-event or
 * on-demand route would move no figure, because the route is already outside
 * Official Departure OTP (rules.ts). A route with no classification row counts
 * as fixed route, so a new route is reviewable by default rather than
 * silently escaping review.
 *
 * Approved Stop Exclusions are deliberately NOT filtered out. A stop already
 * excluded stays in front of the reviewer so a past decision can be seen and
 * reversed - re-reviewing the same stop upserts in place.
 */
export function isFlaggedStop(row: FlaggableStopRow, threshold: number): boolean {
  if ((row.route_category ?? FIXED_ROUTE_CATEGORY) !== FIXED_ROUTE_CATEGORY) return false;
  return stopBias(row) > threshold;
}

/** The month's Flagged Stops, worst lean first. */
export function flagStops(rows: readonly FlaggableStopRow[], threshold: number): FlaggedStop[] {
  return rows
    .filter((row) => isFlaggedStop(row, threshold))
    .sort((a, b) => stopBias(b) - stopBias(a))
    .map((row) => ({
      route_id: row.route_id,
      route_label: row.route_label,
      stop_id: row.stop_id,
      stop_name: row.stop_name,
      day_of_week: row.day_of_week,
      total: row.total ?? 0,
      pct_early: share(row.pct_early),
      pct_ontime: share(row.pct_ontime),
      pct_late: share(row.pct_late),
      pct_missed: share(row.pct_missed),
    }));
}

/**
 * The rows the rule answers over, for one month. The route category comes from
 * rules.ts, the same expression the measurement and the reporting view use;
 * route_label prefers the classification's name so a stop and its route line
 * up under one name, as otpRouteFiguresSql does.
 */
export function flaggableStopRowsSql(): string {
  return `
    SELECT otp.route_id,
      COALESCE(classification.route_label, otp.route_label) route_label,
      otp.stop_id,
      otp.stop_name,
      otp.day_of_week,
      ${otpRouteCategorySql()} route_category,
      otp.total,
      otp.pct_early,
      otp.pct_ontime,
      otp.pct_late,
      otp.pct_missed
    FROM dbo.OtpMonthlyRouteStopDay otp
    LEFT JOIN dbo.RouteClassification classification
      ON classification.route_id = otp.route_id
    WHERE otp.service_month = @month`;
}

/** The month's Flagged Stops at `threshold`. The caller supplies the threshold. */
export async function readFlaggedStops(
  executor: Executor,
  month: string,
  threshold: number,
): Promise<FlaggedStop[]> {
  const req = executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();
  req.input("month", sql.Char(6), month);
  const result = await req.query<FlaggableStopRow>(flaggableStopRowsSql());
  return flagStops(result.recordset, threshold);
}
