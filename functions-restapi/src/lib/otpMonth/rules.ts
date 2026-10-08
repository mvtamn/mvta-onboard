// What counts toward a month's fixed-route on-time performance, as one rule in
// SQL and its TypeScript twin.
//
// Two filters are part of the measurement, not incidental:
//
//   Only route_category 'FixedRoute' counts. Special-event and on-demand
//   service is not part of the fixed-route contractor's regular obligation,
//   which is the reason RouteClassification exists
//   (OTP-Feed-Evaluation-and-Recommendation.md). A route with no
//   classification row is treated as fixed route, so a new route counts by
//   default rather than silently escaping the standard.
//
//   Approved OtpStopExclusions are removed - recovery and layover stops a
//   human reviewed and approved. Raw and excluded are reported alongside the
//   assessable figure, so the contractor can see what came out and the dispute
//   process has something to work from (ADR 0012, CONTEXT "Assessable Input").
//
// The same expression is what vw_OtpMonthlyRouteStop publishes as
// IsAssessable, verbatim: rules.test.ts reads migration 106 and fails if the
// view and this file have drifted apart.

export const FIXED_ROUTE_CATEGORY = "FixedRoute";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function alias(name: string): string {
  if (!IDENTIFIER.test(name)) throw new TypeError("an OTP alias must be a plain identifier");
  return name;
}

/**
 * The assessable test over a joined row: a fixed-route row with no approved
 * stop exclusion. `classification` and `exclusion` are the aliases of the two
 * LEFT JOINs below.
 */
export function otpAssessableSql(classification = "classification", exclusion = "exclusion"): string {
  return `CASE WHEN ISNULL(${alias(classification)}.route_category, N'${FIXED_ROUTE_CATEGORY}') = N'${FIXED_ROUTE_CATEGORY}'
                     AND ${alias(exclusion)}.id IS NULL THEN 1 ELSE 0 END`;
}

/**
 * The joins that test answers over, for a query reading
 * OtpMonthlyRouteStopDay as `otp`. A stop exclusion is keyed by month, route,
 * stop and day of week - the grain the monthly feed itself has.
 */
export function otpAssessableJoinsSql(otp = "otp", classification = "classification", exclusion = "exclusion"): string {
  const o = alias(otp);
  return `LEFT JOIN dbo.RouteClassification ${alias(classification)}
  ON ${classification}.route_id = ${o}.route_id
LEFT JOIN dbo.OtpStopExclusions ${alias(exclusion)}
  ON ${exclusion}.service_month = ${o}.service_month
 AND ${exclusion}.route_id = ${o}.route_id
 AND ${exclusion}.stop_id = ${o}.stop_id
 AND ${exclusion}.day_of_week = ${o}.day_of_week
 AND ${exclusion}.status = 'approved'`;
}

/** The route category a row is measured under. */
export function otpRouteCategorySql(classification = "classification"): string {
  return `ISNULL(${alias(classification)}.route_category, N'${FIXED_ROUTE_CATEGORY}')`;
}

/**
 * The joined snapshot of what approved date exclusions took out, aggregated to
 * the measurement's own grain. One month can exclude several dates sharing a
 * day of week - two snow Mondays - so the rows sum before they subtract.
 *
 * Only 'Approved' exclusions subtract. A 'Proposed' one is somebody's request,
 * and the figure does not move on a request.
 */
export function otpDateExcludedJoinSql(otp = "otp", dates = "dates"): string {
  const o = alias(otp);
  return `LEFT JOIN (
  SELECT d.service_month, d.route_id, d.stop_id, d.day_of_week,
         SUM(d.total) total, SUM(d.ontime) ontime
  FROM dbo.OtpDateExclusionDepartures d
  JOIN dbo.OtpDateExclusions e ON e.id = d.exclusion_id AND e.status = 'Approved'
  GROUP BY d.service_month, d.route_id, d.stop_id, d.day_of_week
) ${alias(dates)}
  ON ${dates}.service_month = ${o}.service_month
 AND ${dates}.route_id = ${o}.route_id
 AND ${dates}.stop_id = ${o}.stop_id
 AND ${dates}.day_of_week = ${o}.day_of_week`;
}

/**
 * One row's assessable count of `column`: zero unless the row passes the
 * category and stop-exclusion test, and then its own count less whatever
 * approved date exclusions took out of it.
 *
 * Clamped at zero. A snapshot larger than the row it subtracts from means the
 * monthly feed was restated downward after the date was approved; a negative
 * departure count is not something to hand a report, and the clamp fails in
 * the direction that keeps the contractor's figure honest rather than
 * inventing departures.
 *
 * vw_OtpMonthlyRouteStop publishes this same expression as
 * AssessableTotalDepartures / AssessableOnTimeDepartures.
 */
export function otpAssessableCountSql(
  column: "total" | "ontime",
  otp = "otp",
  classification = "classification",
  exclusion = "exclusion",
  dates = "dates",
): string {
  if (column !== "total" && column !== "ontime") throw new TypeError("an OTP count is total or ontime");
  const net = `ISNULL(${alias(otp)}.${column}, 0) - ISNULL(${alias(dates)}.${column}, 0)`;
  return `CASE WHEN ISNULL(${alias(classification)}.route_category, N'${FIXED_ROUTE_CATEGORY}') = N'${FIXED_ROUTE_CATEGORY}' AND ${alias(exclusion)}.id IS NULL
       THEN CASE WHEN ${net} > 0
                 THEN ${net} ELSE 0 END
       ELSE 0 END`;
}

/**
 * Avail's own day-of-week spellings, indexed by `Date.getUTCDay()`. The feed
 * says 'Tues' and 'Thur', not 'Tue' and 'Thu', and a date exclusion only
 * subtracts from a monthly row if the two strings match exactly - so this is
 * load-bearing, not cosmetic.
 *
 * Confirmed against every distinct value in OtpMonthlyRouteStopDay on dev
 * (2026-09-22). The approval path checks its derived value against the month's
 * own rows before writing a snapshot rather than trusting this list alone, so
 * a change on Avail's side refuses the approval instead of silently
 * subtracting nothing.
 */
export const AVAIL_DAY_OF_WEEK = ["Sun", "Mon", "Tues", "Wed", "Thur", "Fri", "Sat"] as const;

/** Avail's day-of-week string for a YYYYMMDD service date. */
export function availDayOfWeek(serviceDate: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(serviceDate);
  if (!match) throw new TypeError("a service date is YYYYMMDD");
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
    throw new TypeError("a service date is a real calendar date");
  }
  return AVAIL_DAY_OF_WEEK[date.getUTCDay()];
}

/** The service month a YYYYMMDD date falls in. */
export function serviceMonthOfDate(serviceDate: string): string {
  return serviceDate.slice(0, 6);
}

export interface OtpClassifiableRow {
  /** RouteClassification.route_category, or null when the route has no row. */
  route_category: string | null;
  /** Whether an approved OtpStopExclusions row covers this stop and day. */
  stop_excluded: boolean;
}

/** The same test in TypeScript, for readers that already hold the rows. */
export function isOtpRowAssessable(row: OtpClassifiableRow): boolean {
  return (row.route_category ?? FIXED_ROUTE_CATEGORY) === FIXED_ROUTE_CATEGORY && !row.stop_excluded;
}

/**
 * One row's assessable count, in TypeScript: the SQL twin of
 * otpAssessableCountSql, including its clamp.
 */
export function otpAssessableCount(row: OtpClassifiableRow, count: number | null, dateExcluded: number | null): number {
  if (!isOtpRowAssessable(row)) return 0;
  return Math.max(0, (count ?? 0) - (dateExcluded ?? 0));
}
