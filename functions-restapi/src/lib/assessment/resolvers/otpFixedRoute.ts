import { measureOtpMonth } from "../../otpMonth";
import type { ResolvedMeasurement, ResolverContext } from "./types";

// Fixed-route on-time performance for the month, from Avail's monthly
// OtpByRouteStopDayAgg feed (stored as OtpMonthlyRouteStopDay).
//
// What counts - fixed-route routes only, minus approved stop exclusions - is
// the OTP month measurement module's rule (lib/otpMonth), which the console,
// GET /otp-monthly, the trend and vw_OtpMonthlyRouteStop all read too. This
// resolver turns that measurement into the shape the assessment stores: raw
// and excluded alongside the assessable figure, so the report can show the
// contractor what came out and the dispute process has something to work from.
export async function resolveOtpFixedRoute(context: ResolverContext): Promise<ResolvedMeasurement> {
  const measurement = await measureOtpMonth(context.tx, context.month);
  const { raw, excluded, assessable } = measurement;
  return {
    metricValue: assessable.pct,
    rawMetricValue: raw.pct,
    excludedMetricValue: excluded.pct,
    rawQuantity: raw.departures,
    excludedQuantity: excluded.departures,
    quantity: 1,
    occurrenceCount: 0,
    completeness: assessable.departures > 0 ? 100 : 0,
    sourceRefs: [`OtpMonthlyRouteStopDay:${context.month}`],
    // A month with no departures in the feed is a feed gap, not 0% on-time.
    unresolvedReason: assessable.departures > 0 ? undefined
      : "No fixed-route departures are recorded in the monthly OTP feed for this month.",
  };
}
