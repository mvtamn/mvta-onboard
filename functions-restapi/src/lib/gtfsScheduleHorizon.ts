// How far ahead the imported static GTFS schedule actually covers.
//
// The silent-no-show detector infers a missed trip from a scheduled trip that
// never reported. Its first step is activeServiceIdsToday(), and when the
// schedule contains no service for the day it returns no service ids and
// detection returns 0 before doing any work. That is indistinguishable, from
// the outside, from a day on which nothing was missed.
//
// A schedule that has simply run out reaches exactly that state, and it does
// so while looking healthy: gtfsStopsSync imports the expired feed
// successfully every morning and records a successful gtfs_static ingestion,
// so the KPI trust banner stays green while detection quietly does nothing.
// MVTA's feed publishes service through calendar_dates.txt with no
// calendar.txt at all, one row per calendar day, so its coverage simply stops
// on a fixed date rather than tapering.
//
// The coverage rule below is deliberately the same one activeServiceIdsToday
// applies in SQL - a day is covered when a GtfsCalendar row runs on that
// weekday within its date range and is not removed by an exception_type 2
// override, or when a GtfsCalendarDates row adds it with exception_type 1.
// Both live in this file so they cannot drift apart: activeServiceIdsToday
// is the SQL form (used by the missed-trip detector and the trip-start log
// materializer), serviceDateIsCovered the pure form (used by the coverage
// check and the rotation pools).
import type { GtfsCalendarDateRow, GtfsCalendarRow } from "./gtfsStatic";
import { sql } from "./db";
import { agencyServiceDate } from "./missedTripTime";

// The service_ids that run on one agency service date: GtfsCalendar rows
// whose weekday flag is set and whose date range covers the day, minus
// exception_type 2 removals, plus exception_type 1 additions. `dow` is the
// lowercase weekday name agencyServiceDate() returns, interpolated as a
// column name - it is never user input.
export async function activeServiceIdsToday(pool: sql.ConnectionPool, serviceDate: string, dow: string): Promise<string[]> {
  const req = pool.request();
  req.input("service_date", sql.Char(8), serviceDate);
  const result = await req.query<{ service_id: string }>(`
    SELECT c.service_id
    FROM GtfsCalendar c
    WHERE c.${dow} = 1
      AND @service_date BETWEEN c.start_date AND c.end_date
      AND NOT EXISTS (
        SELECT 1 FROM GtfsCalendarDates cd
        WHERE cd.service_id = c.service_id AND cd.service_date = @service_date AND cd.exception_type = 2
      )
    UNION
    SELECT cd.service_id
    FROM GtfsCalendarDates cd
    WHERE cd.service_date = @service_date AND cd.exception_type = 1
  `);
  return result.recordset.map((r) => r.service_id);
}

const DOW: readonly (keyof GtfsCalendarRow)[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

export interface ScheduleCoverage {
  /** The agency-local service date the check was made against. */
  service_date: string;
  /** Whether any service runs on that date - false means detection is inert. */
  covered_today: boolean;
  /**
   * Consecutive covered days starting at service_date, capped at lookaheadDays.
   * 0 when today is uncovered.
   */
  days_covered_ahead: number;
  /** The last covered date within the lookahead window, if any. */
  last_covered_date: string | null;
}

export function serviceDateOffset(serviceDate: string, days: number): { date: string; dow: string } {
  const year = Number(serviceDate.slice(0, 4));
  const month = Number(serviceDate.slice(4, 6));
  const day = Number(serviceDate.slice(6, 8));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const date =
    `${shifted.getUTCFullYear()}` +
    `${String(shifted.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(shifted.getUTCDate()).padStart(2, "0")}`;
  return { date, dow: DOW[shifted.getUTCDay()] as string };
}

export function serviceDateIsCovered(
  calendar: readonly GtfsCalendarRow[],
  calendarDates: readonly GtfsCalendarDateRow[],
  serviceDate: string,
  dow: string,
): boolean {
  // An explicit "service added" override is sufficient on its own, exactly as
  // in the SQL UNION - it needs no GtfsCalendar row behind it, which is what
  // makes a calendar_dates-only feed legal.
  if (calendarDates.some((cd) => cd.service_date === serviceDate && cd.exception_type === 1)) {
    return true;
  }
  return calendar.some((c) => {
    if (c[dow as keyof GtfsCalendarRow] !== true) return false;
    if (serviceDate < c.start_date || serviceDate > c.end_date) return false;
    return !calendarDates.some(
      (cd) =>
        cd.service_id === c.service_id &&
        cd.service_date === serviceDate &&
        cd.exception_type === 2,
    );
  });
}

export function scheduleCoverage(
  calendar: readonly GtfsCalendarRow[],
  calendarDates: readonly GtfsCalendarDateRow[],
  now: Date,
  lookaheadDays = 14,
): ScheduleCoverage {
  const { serviceDate, dow } = agencyServiceDate(now);
  if (!serviceDateIsCovered(calendar, calendarDates, serviceDate, dow)) {
    return {
      service_date: serviceDate,
      covered_today: false,
      days_covered_ahead: 0,
      last_covered_date: null,
    };
  }

  // Consecutive, not total: a schedule covering today and then a gap is more
  // useful to report by when it stops than by how many days it holds overall.
  let daysAhead = 1;
  let lastCovered = serviceDate;
  for (let offset = 1; offset <= lookaheadDays; offset++) {
    const next = serviceDateOffset(serviceDate, offset);
    if (!serviceDateIsCovered(calendar, calendarDates, next.date, next.dow)) break;
    daysAhead++;
    lastCovered = next.date;
  }
  return {
    service_date: serviceDate,
    covered_today: true,
    days_covered_ahead: daysAhead,
    last_covered_date: lastCovered,
  };
}
