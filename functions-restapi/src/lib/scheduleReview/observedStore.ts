// The one query behind the observed overlay: Avail's early/on-time/late
// counts for a route's timepoints over a window of service days, summed per
// stop, direction and hour. Reads OtpDailyRouteStopHour (migration 020) as the
// daily poll stores it: calendar_date is a Central service day, YYYYMMDD.
//
// Joins on the assumption increment 0 checks: Avail's route and stop ids are
// the GTFS ids. route_id is INT in the OTP table and NVARCHAR in GTFS, so the
// GTFS id is cast on the way in; a non-numeric id matches nothing.
import { sql } from "../db";
import { agencyServiceDate } from "../missedTripTime";
import type { ObservedDayKind, ObservedRow, ObservedWindow } from "./observed";

export const OBSERVED_WINDOW_DAYS = [7, 28, 90] as const;
export const OBSERVED_DEFAULT_DAYS = 28;

export function parseObservedDays(value: string | null): number {
  const days = Number(value);
  return (OBSERVED_WINDOW_DAYS as readonly number[]).includes(days) ? days : OBSERVED_DEFAULT_DAYS;
}

export function parseObservedDow(value: string | null): ObservedDayKind {
  return value === "saturday" || value === "sunday" ? value : "weekday";
}

// 1900-01-01 was a Monday, so this is 0 for Monday through 6 for Sunday
// whatever the session's DATEFIRST or language.
const DOW_SQL = "((DATEDIFF(DAY, '19000101', CONVERT(DATE, calendar_date, 112)) % 7) + 7) % 7";
const DOW_FILTER: Record<ObservedDayKind, string> = {
  weekday: `${DOW_SQL} BETWEEN 0 AND 4`,
  saturday: `${DOW_SQL} = 5`,
  sunday: `${DOW_SQL} = 6`,
};

export interface ObservedRowsResult {
  rows: ObservedRow[];
  window: ObservedWindow;
}

export async function loadObservedRows(
  pool: sql.ConnectionPool,
  routeId: string,
  days: number,
  dow: ObservedDayKind,
  now = new Date(),
): Promise<ObservedRowsResult> {
  // The window ends on the last completed service day: Avail publishes a day only after it ends.
  const until = agencyServiceDate(now, -1).serviceDate;
  const since = agencyServiceDate(now, -days).serviceDate;
  const filter = DOW_FILTER[dow];
  const request = pool.request()
    .input("route_id", sql.NVarChar(50), routeId)
    .input("since", sql.Char(8), since)
    .input("until", sql.Char(8), until);
  const result = await request.query<ObservedRow>(`
    SELECT CAST(stop_id AS NVARCHAR(50)) AS stop_id,
           MAX(stop_name) AS stop_name,
           direction,
           hour_of_day,
           SUM(ISNULL(early, 0)) AS early,
           SUM(ISNULL(ontime, 0)) AS ontime,
           SUM(ISNULL(late, 0)) AS late,
           SUM(ISNULL(total, 0)) AS total
    FROM OtpDailyRouteStopHour
    WHERE route_id = TRY_CAST(@route_id AS INT)
      AND calendar_date BETWEEN @since AND @until
      AND ${filter}
    GROUP BY stop_id, direction, hour_of_day
  `);
  const span = await pool.request()
    .input("route_id", sql.NVarChar(50), routeId)
    .input("since", sql.Char(8), since)
    .input("until", sql.Char(8), until)
    .query<{ first_day: string | null; last_day: string | null; service_days: number }>(`
      SELECT MIN(calendar_date) AS first_day, MAX(calendar_date) AS last_day, COUNT(DISTINCT calendar_date) AS service_days
      FROM OtpDailyRouteStopHour
      WHERE route_id = TRY_CAST(@route_id AS INT)
        AND calendar_date BETWEEN @since AND @until
        AND ${filter}
    `);
  const covered = span.recordset[0];
  return {
    rows: result.recordset.map((r) => ({
      stop_id: String(r.stop_id),
      stop_name: r.stop_name,
      direction: r.direction,
      hour_of_day: Number(r.hour_of_day),
      early: Number(r.early),
      ontime: Number(r.ontime),
      late: Number(r.late),
      total: Number(r.total),
    })),
    window: {
      days,
      dow,
      first_day: covered?.first_day ?? null,
      last_day: covered?.last_day ?? null,
      service_days: Number(covered?.service_days ?? 0),
    },
  };
}
