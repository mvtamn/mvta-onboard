// Avail360 OTP By Route/Stop/Day/Hour - promoted from "secondary/drill-down"
// to a first-class, regularly-polled feed per OTP-Feed-Evaluation-and-
// Recommendation (3).md's live-data investigation update (2026-08-05, see
// otp-compliance-live-data-rethink.md). OtpByRouteStopDayAgg
// (otpMonthlyFeed.ts) is a month-level aggregate and structurally cannot
// answer "what was OTP yesterday" - this feed carries a genuine CalendarDate
// per record over a custom Start/End range, which does.
//
// When to ask, confirmed against the live feed 2026-09-17: Avail publishes a
// service day only after it ends. At 05:38 UTC it held 1,988 rows for
// 2026-09-15 and none for 2026-09-16, which had ended 38 minutes earlier. The
// poll used to run at 03:30 UTC (22:30 Central) and ask for the UTC calendar's
// yesterday - the Central day still in service - so it received nothing on
// every run from 2026-08-23 and the table never held a row. See otpDailyWindow.
//
// KNOWN UNCONFIRMED - MORE SO than any other feed built in this project: no
// sample response was ever provided for this specific operation anywhere in
// this repo. Live responses confirmed the envelope and core ID/hour fields
// on 2026-08-22; the URL's param list remains inferred by analogy - Start/End Date swapped in for
// OtpByRouteStopDayAgg's single ServiceDate, same threshold/outlier params
// otherwise. The envelope key is confirmed as lowercase "otp" from live
// responses. availClient.ts names unexpected keys - do not remove that diagnostic.
import sql from "mssql";
import { agencyServiceDate, serviceDateAndGtfsSecondsToUtc } from "./missedTripTime";

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

// Avail sends "2026-09-15T00:00:00.000" with no zone: a calendar date, not an
// instant. Read the date digits directly - handing it to new Date() interprets
// it in the host's zone, which only happens to give the right day in UTC.
function parseCalendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const check = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (check.getUTCMonth() !== Number(m) - 1 || check.getUTCDate() !== Number(d)) return null;
  return `${y}${m}${d}`;
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

// How many completed Central service days each run re-reads. Avail's publishing
// delay after a day ends has not been measured, so the newest day may still be
// empty when the poll runs; re-reading the days before it lets a late day fill
// in on the next run instead of being missed for good. The upsert makes the
// overlap free of duplicates.
export const OTP_DAILY_TRAILING_DAYS = 3;

export interface OtpDailyWindow {
  // Oldest first, YYYYMMDD in agency (America/Chicago) time.
  serviceDates: string[];
  // For availClient, which formats these from their UTC calendar fields:
  // UTC midnight of each service date's own calendar day.
  requestStart: Date;
  requestEnd: Date;
}

// The completed service days a run at `now` should fetch: the Central days
// before the one `now` falls in. Never the current day, which Avail has not
// published and which would read as an empty day.
export function otpDailyWindow(now: Date, days = OTP_DAILY_TRAILING_DAYS): OtpDailyWindow {
  const serviceDates = Array.from({ length: days }, (_, i) => agencyServiceDate(now, i - days).serviceDate);
  const asUtcCalendarDay = (serviceDate: string) =>
    new Date(Date.UTC(Number(serviceDate.slice(0, 4)), Number(serviceDate.slice(4, 6)) - 1, Number(serviceDate.slice(6, 8))));
  return {
    serviceDates,
    requestStart: asUtcCalendarDay(serviceDates[0]),
    requestEnd: asUtcCalendarDay(serviceDates[serviceDates.length - 1]),
  };
}

// The Data coverage a run may record: from the start of the oldest requested
// Central day to the end of the newest day that actually returned rows. A day
// Avail has not published yet is not covered, even though it was asked for.
export function otpDailyCoverage(
  window: OtpDailyWindow,
  storedDates: Iterable<string>,
): { startAt: Date | null; endAt: Date | null } | undefined {
  const stored = new Set(storedDates);
  const newest = [...window.serviceDates].reverse().find((date) => stored.has(date));
  if (!newest) return undefined;
  return {
    startAt: serviceDateAndGtfsSecondsToUtc(window.serviceDates[0], 0),
    endAt: serviceDateAndGtfsSecondsToUtc(newest, 24 * 60 * 60),
  };
}

// Keyed by direction as well (migration 123): Avail returns one row per
// direction a route serves a stop in an hour, and the original key let the
// second direction overwrite the first. NULL matches NULL, as the unique
// constraint treats it.
export async function upsertOtpDailyReport(pool: sql.ConnectionPool, mapped: MappedOtpDaily): Promise<void> {
  const request = pool.request();
  request.input("calendar_date", sql.Char(8), mapped.calendar_date);
  request.input("hour_of_day", sql.TinyInt, mapped.hour_of_day);
  request.input("route_id", sql.Int, mapped.route_id);
  request.input("stop_id", sql.Int, mapped.stop_id);
  request.input("stop_name", sql.NVarChar, mapped.stop_name);
  request.input("route_label", sql.NVarChar, mapped.route_label);
  request.input("pct_early", sql.Float, mapped.pct_early);
  request.input("pct_ontime", sql.Float, mapped.pct_ontime);
  request.input("pct_late", sql.Float, mapped.pct_late);
  request.input("pct_not_ontime", sql.Float, mapped.pct_not_ontime);
  request.input("pct_missed", sql.Float, mapped.pct_missed);
  request.input("early", sql.Int, mapped.early);
  request.input("ontime", sql.Int, mapped.ontime);
  request.input("late", sql.Int, mapped.late);
  request.input("missed", sql.Int, mapped.missed);
  request.input("actual_departures", sql.Int, mapped.actual_departures);
  request.input("total", sql.Int, mapped.total);
  request.input("latitude", sql.Float, mapped.latitude);
  request.input("longitude", sql.Float, mapped.longitude);
  request.input("direction", sql.NVarChar(20), mapped.direction);
  await request.query(`
    MERGE OtpDailyRouteStopHour WITH (HOLDLOCK) AS target
    USING (
      SELECT @calendar_date AS calendar_date, @route_id AS route_id,
             @stop_id AS stop_id, @hour_of_day AS hour_of_day, @direction AS direction
    ) AS src
    ON target.calendar_date = src.calendar_date AND target.route_id = src.route_id
       AND target.stop_id = src.stop_id AND target.hour_of_day = src.hour_of_day
       AND (target.direction = src.direction OR (target.direction IS NULL AND src.direction IS NULL))
    WHEN MATCHED THEN
      UPDATE SET
        stop_name = @stop_name, route_label = @route_label,
        pct_early = @pct_early, pct_ontime = @pct_ontime, pct_late = @pct_late,
        pct_not_ontime = @pct_not_ontime, pct_missed = @pct_missed,
        early = @early, ontime = @ontime, late = @late, missed = @missed,
        actual_departures = @actual_departures, total = @total,
        latitude = @latitude, longitude = @longitude,
        updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (
        calendar_date, hour_of_day, route_id, stop_id, stop_name, route_label,
        pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
        early, ontime, late, missed, actual_departures, total,
        latitude, longitude, direction
      )
      VALUES (
        @calendar_date, @hour_of_day, @route_id, @stop_id, @stop_name, @route_label,
        @pct_early, @pct_ontime, @pct_late, @pct_not_ontime, @pct_missed,
        @early, @ontime, @late, @missed, @actual_departures, @total,
        @latitude, @longitude, @direction
      );
  `);
}
