// The Dispatch Log's weekly verification rotation, computed rather than
// copied from a workbook. See plans/dispatch-log-spec.md §4.1.
//
// The OCS desk verifies every revenue trip once a week: trips are sorted by
// start time and dealt round-robin across the days of the week, and each
// following week the deal shifts down one day. Two pools, dealt
// independently - weekday trips over Mon-Fri, weekend trips over Sat/Sun.
//
// The deal has to be reproducible for any date, which needs three things the
// workbook gets for free by being a fixed document:
//
// 1. A stable pool. Membership is decided per rotation week (the 7 days from
//    anchor + 7 * weekOffset), not per date: a service that runs on at least
//    one Mon-Fri date in that window is in the weekday pool, one that runs on
//    a Sat or Sun is in the weekend pool. Rebuilding per date would shift
//    every index on Friday, whose trip set differs from Mon-Thu, and lose the
//    "each trip once per week" guarantee. Scoping to the week also keeps a
//    future service change's trips out of the current pool when the static
//    feed carries both.
// 2. A deterministic order. (first_departure_seconds, trip_id) - start time
//    alone is not unique.
// 3. An anchor. weekOffset counts whole weeks since rotation_anchor_date,
//    a setting the materializer reads from AppSettings.
//
// A trip is on a given date's verification list when its assigned day is that
// date's weekday. The caller only asks about trips that actually run that
// date, so a Mon-Thu-only trip dealt to Friday is skipped that week rather
// than listed as a trip that never comes.
import type { GtfsCalendarDateRow, GtfsCalendarRow } from "./gtfsStatic";
import { serviceDateIsCovered, serviceDateOffset } from "./gtfsScheduleHorizon";

export const WEEKDAY_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export const WEEKEND_DAYS = ["saturday", "sunday"] as const;
export type DayName = (typeof WEEKDAY_DAYS)[number] | (typeof WEEKEND_DAYS)[number];
export type PoolKind = "weekday" | "weekend";

export interface RotationTrip {
  trip_id: string;
  service_id: string;
  first_departure_seconds: number;
}

export interface RotationAssignment {
  /** Day this trip is verified on when the date is a weekday, if in that pool. */
  weekday_day: DayName | null;
  /** Day this trip is verified on when the date is Sat/Sun, if in that pool. */
  weekend_day: DayName | null;
}

export interface Rotation {
  anchor_date: string;
  week_offset: number;
  weekday_pool_size: number;
  weekend_pool_size: number;
  assignments: Map<string, RotationAssignment>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function serviceDateToUtcMs(serviceDate: string): number {
  return Date.UTC(
    Number(serviceDate.slice(0, 4)),
    Number(serviceDate.slice(4, 6)) - 1,
    Number(serviceDate.slice(6, 8)),
  );
}

export function isValidServiceDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const ms = serviceDateToUtcMs(value);
  return Number.isFinite(ms) && serviceDateOffset(value, 0).date === value;
}

/** Whole weeks from the anchor to the service date; negative before the anchor. */
export function rotationWeekOffset(anchorDate: string, serviceDate: string): number {
  const days = Math.round((serviceDateToUtcMs(serviceDate) - serviceDateToUtcMs(anchorDate)) / MS_PER_DAY);
  return Math.floor(days / 7);
}

/** The seven service dates of one rotation week, with their weekday names. */
export function rotationWeekDates(anchorDate: string, weekOffset: number): Array<{ date: string; dow: string }> {
  const dates: Array<{ date: string; dow: string }> = [];
  for (let i = 0; i < 7; i++) dates.push(serviceDateOffset(anchorDate, weekOffset * 7 + i));
  return dates;
}

// Pure counterpart of activeServiceIdsToday's SQL, restricted to one service.
function serviceRunsOn(
  serviceId: string,
  calendar: readonly GtfsCalendarRow[],
  calendarDates: readonly GtfsCalendarDateRow[],
  date: string,
  dow: string,
): boolean {
  return serviceDateIsCovered(
    calendar.filter((c) => c.service_id === serviceId),
    calendarDates.filter((cd) => cd.service_id === serviceId),
    date,
    dow,
  );
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function dealPool(tripIds: readonly string[], days: readonly DayName[], weekOffset: number): Map<string, DayName> {
  const dealt = new Map<string, DayName>();
  tripIds.forEach((tripId, index) => {
    dealt.set(tripId, days[positiveModulo(index + weekOffset, days.length)] as DayName);
  });
  return dealt;
}

export function computeRotation(
  trips: readonly RotationTrip[],
  calendar: readonly GtfsCalendarRow[],
  calendarDates: readonly GtfsCalendarDateRow[],
  anchorDate: string,
  serviceDate: string,
): Rotation {
  const weekOffset = rotationWeekOffset(anchorDate, serviceDate);
  const week = rotationWeekDates(anchorDate, weekOffset);
  const weekdayDates = week.filter((d) => (WEEKDAY_DAYS as readonly string[]).includes(d.dow));
  const weekendDates = week.filter((d) => (WEEKEND_DAYS as readonly string[]).includes(d.dow));

  // Pool membership is a property of the service, so decide it once per
  // service_id rather than once per trip.
  const serviceIds = new Set(trips.map((t) => t.service_id));
  const weekdayServices = new Set<string>();
  const weekendServices = new Set<string>();
  for (const serviceId of serviceIds) {
    if (weekdayDates.some((d) => serviceRunsOn(serviceId, calendar, calendarDates, d.date, d.dow))) {
      weekdayServices.add(serviceId);
    }
    if (weekendDates.some((d) => serviceRunsOn(serviceId, calendar, calendarDates, d.date, d.dow))) {
      weekendServices.add(serviceId);
    }
  }

  const ordered = [...trips].sort(
    (a, b) => a.first_departure_seconds - b.first_departure_seconds || (a.trip_id < b.trip_id ? -1 : a.trip_id > b.trip_id ? 1 : 0),
  );
  const weekdayPool = ordered.filter((t) => weekdayServices.has(t.service_id)).map((t) => t.trip_id);
  const weekendPool = ordered.filter((t) => weekendServices.has(t.service_id)).map((t) => t.trip_id);
  const weekdayDeal = dealPool(weekdayPool, WEEKDAY_DAYS, weekOffset);
  const weekendDeal = dealPool(weekendPool, WEEKEND_DAYS, weekOffset);

  const assignments = new Map<string, RotationAssignment>();
  for (const trip of ordered) {
    const weekdayDay = weekdayDeal.get(trip.trip_id) ?? null;
    const weekendDay = weekendDeal.get(trip.trip_id) ?? null;
    if (weekdayDay || weekendDay) {
      assignments.set(trip.trip_id, { weekday_day: weekdayDay, weekend_day: weekendDay });
    }
  }

  return {
    anchor_date: anchorDate,
    week_offset: weekOffset,
    weekday_pool_size: weekdayPool.length,
    weekend_pool_size: weekendPool.length,
    assignments,
  };
}

/** The day a trip is verified on for dates of the given weekday's pool. */
export function rotationDayFor(rotation: Rotation, tripId: string, dow: string): DayName | null {
  const assignment = rotation.assignments.get(tripId);
  if (!assignment) return null;
  return (WEEKEND_DAYS as readonly string[]).includes(dow) ? assignment.weekend_day : assignment.weekday_day;
}

/** Whether a trip that runs on the date is on that date's verification list. */
export function inRotation(rotation: Rotation, tripId: string, dow: string): boolean {
  return rotationDayFor(rotation, tripId, dow) === dow;
}
