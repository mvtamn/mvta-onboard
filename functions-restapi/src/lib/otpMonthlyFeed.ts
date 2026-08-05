// Avail360 OTP Monthly By Route/Stop/Day of Week - the recommended primary
// OTP feed per OTP-Feed-Evaluation-and-Recommendation.md (repo root).
// Auto-aggregates to the whole month containing whatever service date is
// passed - no date-range math, no risk of a partial month. Records carry
// DayOfWeek but no month/date field of their own, so the caller stamps the
// request's own service_month onto each mapped row.
//
// KNOWN UNCONFIRMED ASSUMPTION: the doc only shows a single record's shape,
// not the full HTTP envelope. The two other Avail360 feeds already
// integrated this session turned out to wrap their array under a key
// matching the feed's own Operation ID/model name (AVL Reports:
// result["AVL Reports"]; Pullout: result.Pullout) - this guesses
// result.OtpByRouteStopDayAgg by the same pattern. If a real response ever
// comes back with reports.length === 0 when service data should exist, this
// key is almost certainly wrong - check a real raw response and correct it.
export interface OtpMonthlyReport {
  DayOfWeek: string;
  StopID: number;
  StopInternetName: string | null;
  RouteReportLabel: string | null;
  RouteID: number;
  PercentEarly: number;
  PercentOntime: number;
  PercentLate: number;
  PercentNotOntime: number;
  PercentMissed: number;
  Early: number;
  Ontime: number;
  Late: number;
  Missed: number;
  ActualDepartures: number;
  Total: number;
}

export interface OtpMonthlyEnvelope {
  errors: string[];
  result: {
    OtpByRouteStopDayAgg: OtpMonthlyReport[];
  };
  success: boolean;
}

// Both otpMonthlyFeed.ts and availMissedTripsFeed.ts use MM-DD-YYYY per the
// doc ("Pass any service date (MM-DD-YYYY)") - unlike AVL/Pullout's
// YYYY-MM-DD. Defined once here since this file is authored first.
export function formatDateMmDdYyyy(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${m}-${d}-${y}`;
}

export function serviceMonthOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

const EARLY_THRESHOLD = 1; // fixed, enum-constrained per the API schema
const LATE_THRESHOLD = 5; // fixed, enum-constrained per the API schema
const EARLY_OUTLIER_MINUTES = 15; // owner decision - separate from the threshold above
const LATE_OUTLIER_MINUTES = 30; // owner decision
const SHOW_MISSED_STOPS = 0;
const INCLUDE_OUTLIERS = 1;
const SHOW_DETOURS = 1;

// baseUrl is the agency-level URL with no trailing path segments, e.g.
// "https://avail360-api.myavail.cloud/OtpByRouteStopDayAgg/v1/MVTA".
export async function fetchOtpMonthlyReports(
  baseUrl: string,
  apiKey: string,
  date: Date = new Date(),
): Promise<OtpMonthlyReport[]> {
  const url =
    `${baseUrl.replace(/\/+$/, "")}/${formatDateMmDdYyyy(date)}` +
    `/${EARLY_THRESHOLD}/${LATE_THRESHOLD}/${EARLY_OUTLIER_MINUTES}/${LATE_OUTLIER_MINUTES}` +
    `/${SHOW_MISSED_STOPS}/${INCLUDE_OUTLIERS}/${SHOW_DETOURS}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Avail OTP Monthly request failed: ${res.status}`);
  }
  const payload = (await res.json()) as OtpMonthlyEnvelope;
  if (!payload.success) {
    throw new Error(
      `Avail OTP Monthly API returned success=false: ${payload.errors?.join(", ") || "no error detail"}`,
    );
  }
  const rows = payload.result?.OtpByRouteStopDayAgg;
  if (rows !== undefined) return rows;

  // The guessed envelope key (see the KNOWN UNCONFIRMED ASSUMPTION above)
  // wasn't found. If result carries any OTHER key, that's almost certainly
  // the real array key and this is loudly wrong rather than silently
  // returning zero rows every poll - surface the actual key names (never
  // the data itself) so the fix is a one-line correction, not a re-guess.
  const actualKeys = payload.result ? Object.keys(payload.result) : [];
  if (actualKeys.length > 0) {
    throw new Error(
      `Avail OTP Monthly response has no "OtpByRouteStopDayAgg" key under result - found [${actualKeys.join(", ")}] instead. Update the guessed key in otpMonthlyFeed.ts.`,
    );
  }
  return [];
}

export interface MappedOtpMonthlyReport {
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  stop_name: string | null;
  route_label: string | null;
  pct_early: number | null;
  pct_ontime: number | null;
  pct_late: number | null;
  pct_not_ontime: number | null;
  pct_missed: number | null;
  early: number | null;
  ontime: number | null;
  late: number | null;
  missed: number | null;
  actual_departures: number | null;
  total: number | null;
}

// Guard clause, not a throw - a single malformed report shouldn't abort the
// whole poll (same convention as mapAvlReport/mapPulloutReport).
export function mapOtpMonthlyReport(
  report: OtpMonthlyReport,
  serviceMonth: string,
): MappedOtpMonthlyReport | null {
  if (typeof report.RouteID !== "number" || typeof report.StopID !== "number" || !report.DayOfWeek) {
    return null;
  }

  return {
    service_month: serviceMonth,
    route_id: report.RouteID,
    stop_id: report.StopID,
    day_of_week: report.DayOfWeek,
    stop_name: report.StopInternetName ?? null,
    route_label: report.RouteReportLabel ?? null,
    pct_early: report.PercentEarly ?? null,
    pct_ontime: report.PercentOntime ?? null,
    pct_late: report.PercentLate ?? null,
    pct_not_ontime: report.PercentNotOntime ?? null,
    pct_missed: report.PercentMissed ?? null,
    early: report.Early ?? null,
    ontime: report.Ontime ?? null,
    late: report.Late ?? null,
    missed: report.Missed ?? null,
    actual_departures: report.ActualDepartures ?? null,
    total: report.Total ?? null,
  };
}
