import { sql } from "../../db";
import type { ResolvedMeasurement, ResolverContext } from "./types";

// Fixed-route on-time performance for the month, from Avail's monthly
// OtpByRouteStopDayAgg feed (stored as OtpMonthlyRouteStopDay).
//
// Two filters are part of the measurement, not incidental:
//
//   Only route_category 'FixedRoute' counts. Special-event service is not part
//   of the fixed-route contractor's regular obligation, which is the reason
//   RouteClassification exists (OTP-Feed-Evaluation-and-Recommendation.md).
//   A route with no classification row is treated as fixed route, so a new
//   route counts by default rather than silently escaping the standard.
//
//   Approved OtpStopExclusions are removed - recovery/layover stops and
//   weather days that a human reviewed and approved. Raw and excluded are
//   returned alongside the assessable figure so the report can show the
//   contractor what came out and the dispute process has something to work
//   from.
export async function resolveOtpFixedRoute(context: ResolverContext): Promise<ResolvedMeasurement> {
  const request = new sql.Request(context.tx);
  request.input("month", sql.Char(6), context.month);
  const result = await request.query<{ raw_total: number; raw_ontime: number; total: number; ontime: number }>(`
    SELECT
      SUM(ISNULL(otp.total,0)) raw_total,
      SUM(ISNULL(otp.ontime,0)) raw_ontime,
      SUM(CASE WHEN exclusion.id IS NULL THEN ISNULL(otp.total,0) ELSE 0 END) total,
      SUM(CASE WHEN exclusion.id IS NULL THEN ISNULL(otp.ontime,0) ELSE 0 END) ontime
    FROM OtpMonthlyRouteStopDay otp
    LEFT JOIN RouteClassification classification ON classification.route_id=CONVERT(NVARCHAR(50),otp.route_id)
    LEFT JOIN OtpStopExclusions exclusion ON exclusion.service_month=otp.service_month
     AND exclusion.route_id=otp.route_id AND exclusion.stop_id=otp.stop_id
     AND exclusion.day_of_week=otp.day_of_week AND exclusion.status='approved'
    WHERE otp.service_month=@month AND ISNULL(classification.route_category,'FixedRoute')='FixedRoute'
  `);
  const row = result.recordset[0];
  const rawTotal = Number(row?.raw_total ?? 0);
  const rawOntime = Number(row?.raw_ontime ?? 0);
  const total = Number(row?.total ?? 0);
  const ontime = Number(row?.ontime ?? 0);
  const excludedTotal = rawTotal - total;
  return {
    metricValue: total > 0 ? ontime / total : null,
    rawMetricValue: rawTotal > 0 ? rawOntime / rawTotal : null,
    excludedMetricValue: excludedTotal > 0 ? (rawOntime - ontime) / excludedTotal : null,
    rawQuantity: rawTotal,
    excludedQuantity: excludedTotal,
    quantity: 1,
    occurrenceCount: 0,
    completeness: total > 0 ? 100 : 0,
    sourceRefs: [`OtpMonthlyRouteStopDay:${context.month}`],
    // A month with no departures in the feed is a feed gap, not 0% on-time.
    unresolvedReason: total > 0 ? undefined
      : "No fixed-route departures are recorded in the monthly OTP feed for this month.",
  };
}
