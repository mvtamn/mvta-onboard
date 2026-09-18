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
