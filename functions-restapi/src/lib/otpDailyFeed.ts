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
// this repo. Live responses confirmed the envelope and core ID/hour fields
// on 2026-08-22; the URL's param list remains inferred by analogy - Start/End Date swapped in for
// OtpByRouteStopDayAgg's single ServiceDate, same threshold/outlier params
// otherwise. The envelope key is confirmed as lowercase "otp" from live
// responses. availClient.ts names unexpected keys - do not remove that diagnostic.
export interface AvailOtpDailyReport {
  CalendarDate: string;
  Time24Hour: number;
  StopID: number;
  StopInternetName: string | null;
  RouteReportLabel: string | null;
  RouteFareboxID: number;
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
    typeof report.RouteFareboxID !== "number" ||
    typeof report.StopID !== "number" ||
    typeof report.Time24Hour !== "number" ||
    !report.CalendarDate
  ) {
    return null;
  }
  const calendarDate = parseCalendarDate(report.CalendarDate);
  if (!calendarDate) return null;

  return {
    calendar_date: calendarDate,
    hour_of_day: report.Time24Hour,
    route_id: report.RouteFareboxID,
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
