// Avail360 OTP Monthly By Route/Stop/Day of Week - the recommended primary
// OTP feed per OTP-Feed-Evaluation-and-Recommendation.md (repo root).
// Auto-aggregates to the whole month containing whatever service date is
// passed - no date-range math, no risk of a partial month. Records carry
// DayOfWeek but no month/date field of their own, so the caller stamps the
// request's own service_month onto each mapped row.
//
// CONFIRMED live 2026-08-06 (see plans/otp-compliance-live-data-rethink.md):
// the guessed PascalCase key was wrong the whole time - the diagnostic
// below caught it firing across three real months (202608/07/06) once the
// trailing-window backfill actually ran. Real key is lowercase "otp", with
// a sibling "results" metadata array - same pattern as Detours
// ("Detours" -> "detours") and Missed Trips ("MissedTripsByRouteStopDay"
// -> "missed"). Every month this feed has ever polled was genuinely never
// empty - it's been misread since day one, not lacking data.
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
    otp: OtpMonthlyReport[];
    results?: { RefreshTime: string; Property: string }[];
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

// Returns the 1st of the month `months` before `date`'s month - sufficient
// for feeds that "auto-aggregate to whichever month contains the passed
// date," where any date within the target month works. Used by the
// trailing-window backfill (otpMonthlyFeedPoll.ts/availMissedTripsPoll.ts)
// added per OTP-Feed-Evaluation-and-Recommendation (3).md's finding that a
// poll which only ever asks about "the current month" has no way to notice
// a month that was empty on day 1 but populated by Avail days later.
export function subtractMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
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
  const rows = payload.result?.otp;
  if (rows !== undefined) return rows;

  // Kept as a safety net even though the key is now confirmed - if Avail
  // ever changes it again, this stays loud instead of silently returning
  // zero rows.
  const actualKeys = payload.result ? Object.keys(payload.result) : [];
  if (actualKeys.length > 0) {
    throw new Error(
      `Avail OTP Monthly response has no "otp" key under result - found [${actualKeys.join(", ")}] instead. Update the guessed key in otpMonthlyFeed.ts.`,
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
