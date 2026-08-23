// Avail360 OTP By Route/Stop/Day/Hour - promoted from "secondary/drill-down"
// to a first-class, regularly-polled feed per OTP-Feed-Evaluation-and-
// Recommendation (3).md's live-data investigation update (2026-08-05, see
// otp-compliance-live-data-rethink.md). OtpByRouteStopDayAgg
// (otpMonthlyFeed.ts) is a month-level aggregate and structurally cannot
// answer "what was OTP yesterday" - this feed carries a genuine CalendarDate
// per record over a custom Start/End range, which does.
//
// KNOWN UNCONFIRMED - MORE SO than any other feed built in this project: no
// sample response was ever provided for this specific operation anywhere in
// this repo (every other feed integration had at least one example record
// to build the mapping from - this one has none). Field names below are a
// best-guess by close analogy to OtpByRouteStopDayAgg's own fields plus
// CalendarDate (Missed Trips' convention) and Latitude/Longitude/Direction
// (AVL Reports' convention, since the evaluation doc's own summary only
// says this feed "includes lat/long, direction"). The URL's param list is
// guessed by the same analogy - Start/End Date swapped in for
// OtpByRouteStopDayAgg's single ServiceDate, same threshold/outlier params
// otherwise. The envelope key is confirmed as lowercase "otp" from live
// responses; the field mapping remains unconfirmed. The diagnostic below
// names unexpected keys - do not remove it.
export interface AvailOtpDailyReport {
  CalendarDate: string;
  HourOfDay: number;
  StopID: number;
  StopInternetName: string | null;
  RouteReportLabel: string | null;
  RouteID: number;
  PercentEarly: number | null;
  PercentOntime: number | null;
  PercentLate: number | null;
  PercentNotOntime: number | null;
  PercentMissed: number | null;
  Early: number | null;
  Ontime: number | null;
  Late: number | null;
  Missed: number | null;
  ActualDepartures: number | null;
  Total: number | null;
  Latitude: number | null;
  Longitude: number | null;
  Direction: string | null;
}

export interface AvailOtpDailyEnvelope {
  errors: string[];
  result: {
    otp?: AvailOtpDailyReport[];
    OtpByRouteStopDayHour?: AvailOtpDailyReport[];
  };
  success: boolean;
}

const EARLY_THRESHOLD = 1; // same enum-constrained values as otpMonthlyFeed.ts
const LATE_THRESHOLD = 5;
const EARLY_OUTLIER_MINUTES = 15;
const LATE_OUTLIER_MINUTES = 30;
const SHOW_MISSED_STOPS = 0;
const INCLUDE_OUTLIERS = 1;
const SHOW_DETOURS = 1;

function formatDateMmDdYyyy(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${m}-${d}-${y}`;
}

// baseUrl is the agency-level URL with no trailing path segments, e.g.
// "https://avail360-api.myavail.cloud/OtpByRouteStopDayHour/v1/MVTA".
export async function fetchOtpDailyReports(
  baseUrl: string,
  apiKey: string,
  startDate: Date,
  endDate: Date,
): Promise<AvailOtpDailyReport[]> {
  const url =
    `${baseUrl.replace(/\/+$/, "")}/${formatDateMmDdYyyy(startDate)}/${formatDateMmDdYyyy(endDate)}` +
    `/${EARLY_THRESHOLD}/${LATE_THRESHOLD}/${EARLY_OUTLIER_MINUTES}/${LATE_OUTLIER_MINUTES}` +
    `/${SHOW_MISSED_STOPS}/${INCLUDE_OUTLIERS}/${SHOW_DETOURS}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Avail OTP Daily request failed: ${res.status}`);
  }
  const payload = (await res.json()) as AvailOtpDailyEnvelope;
  if (!payload.success) {
    throw new Error(`Avail OTP Daily API returned success=false: ${payload.errors?.join(", ") || "no error detail"}`);
  }
  const rows = payload.result?.otp ?? payload.result?.OtpByRouteStopDayHour;
  if (rows !== undefined) return rows;

  const actualKeys = payload.result ? Object.keys(payload.result) : [];
  if (actualKeys.length > 0) {
    throw new Error(
      `Avail OTP Daily response has no "OtpByRouteStopDayHour" key under result - found [${actualKeys.join(", ")}] instead. Update the guessed key in otpDailyFeed.ts.`,
    );
  }
  return [];
}

export interface MappedOtpDaily {
  calendar_date: string;
  hour_of_day: number;
  route_id: number;
  stop_id: number;
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
  latitude: number | null;
  longitude: number | null;
  direction: string | null;
}

function parseCalendarDate(value: string): string | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// Guard clause, not a throw - a single malformed report shouldn't abort the
// whole poll (same convention as every other mapper in this repo).
export function mapOtpDailyReport(report: AvailOtpDailyReport): MappedOtpDaily | null {
  if (
    typeof report.RouteID !== "number" ||
    typeof report.StopID !== "number" ||
    typeof report.HourOfDay !== "number" ||
    !report.CalendarDate
  ) {
    return null;
  }
  const calendarDate = parseCalendarDate(report.CalendarDate);
  if (!calendarDate) return null;

  return {
    calendar_date: calendarDate,
    hour_of_day: report.HourOfDay,
    route_id: report.RouteID,
    stop_id: report.StopID,
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
    latitude: report.Latitude ?? null,
    longitude: report.Longitude ?? null,
    direction: report.Direction ?? null,
  };
}
