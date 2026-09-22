// Freezing what an approved weather date took out of the month.
//
// The measurement subtracts a stored snapshot, never a live recomputation
// (ADR 0038). This module is where that snapshot is taken: it reads the daily
// OTP feed for the excluded service date, aggregates it to the grain the
// monthly feed is measured on, and writes it against the exclusion.
//
// It is deliberately strict about refusing. A weather date that cannot be
// evidenced must not be approved into a silent no-op, because the reviewer
// would see an approved exclusion, the contractor would see an unchanged
// figure, and nothing on screen would explain the gap.
import { sql } from "./db";
import { availDayOfWeek, serviceMonthOfDate } from "./otpMonth/rules";
import type { Executor } from "./otpMonth";

const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

/** One route/stop's departures on the excluded date. */
export interface DateExclusionDeparture {
  route_id: number;
  stop_id: number;
  total: number;
  ontime: number;
  early: number;
  late: number;
  missed: number;
}

export type SnapshotRefusal =
  | { kind: "no_daily_data" }
  | { kind: "day_of_week_absent"; dayOfWeek: string }
  | { kind: "nothing_to_subtract" };

export type SnapshotOutcome =
  | { kind: "taken"; serviceMonth: string; dayOfWeek: string; rows: number; departures: number }
  | { kind: "refused"; reason: SnapshotRefusal };

/** What a refusal should tell the person who tried to approve. */
export function refusalMessage(reason: SnapshotRefusal, serviceDate: string): string {
  switch (reason.kind) {
    case "no_daily_data":
      return `The daily OTP feed holds no departures for ${serviceDate}, so there is nothing to subtract and no evidence of what this date carried. The feed keeps 90 days and holds nothing before 2026-09-14; a date outside that window has to be excluded on paper instead.`;
    case "day_of_week_absent":
      return `The monthly OTP feed has no ${reason.dayOfWeek} rows for this month, so a ${reason.dayOfWeek} date has nothing to subtract from. Check that the month has been polled.`;
    case "nothing_to_subtract":
      return `No route on ${serviceDate} matches a row in this month's OTP feed, so approving it would change no figure.`;
  }
}

/**
 * The excluded date's departures, from the daily feed, at route/stop grain.
 *
 * Summed over the hours of the day. `scope` narrows it: an Agency exclusion
 * takes every route that ran, a Route exclusion takes one.
 */
export async function readDateDepartures(
  executor: Executor,
  serviceDate: string,
  routeId: number | null,
): Promise<DateExclusionDeparture[]> {
  const req = request(executor);
  req.input("date", sql.Char(8), serviceDate);
  req.input("route", sql.Int, routeId);
  const result = await req.query<DateExclusionDeparture>(`
    SELECT route_id, stop_id,
      SUM(ISNULL(total,0)) total, SUM(ISNULL(ontime,0)) ontime,
      SUM(ISNULL(early,0)) early, SUM(ISNULL(late,0)) late, SUM(ISNULL(missed,0)) missed
    FROM dbo.OtpDailyRouteStopHour
    WHERE calendar_date = @date AND (@route IS NULL OR route_id = @route)
    GROUP BY route_id, stop_id
    HAVING SUM(ISNULL(total,0)) > 0
  `);
  return result.recordset;
}

/**
 * Keep only the rows the month can actually subtract from.
 *
 * A snapshot row that matches no monthly row would sit in the table
 * subtracting nothing forever - and, worse, would make the approved date look
 * evidenced. The daily feed and the monthly feed agree on route and stop
 * identifiers (verified 2026-09-22), so a row that does not match is a real
 * discrepancy rather than a mapping quirk, and it belongs out of the snapshot
 * and in front of a person.
 */
export function matchable(
  departures: readonly DateExclusionDeparture[],
  monthlyKeys: ReadonlySet<string>,
): DateExclusionDeparture[] {
  return departures.filter((row) => monthlyKeys.has(`${row.route_id}-${row.stop_id}`));
}

/** The route/stop keys the month holds for one day of week. */
export async function readMonthlyKeys(executor: Executor, serviceMonth: string, dayOfWeek: string): Promise<Set<string>> {
  const req = request(executor);
  req.input("month", sql.Char(6), serviceMonth);
  req.input("dow", sql.NVarChar(20), dayOfWeek);
  const result = await req.query<{ route_id: number; stop_id: number }>(`
    SELECT route_id, stop_id FROM dbo.OtpMonthlyRouteStopDay
    WHERE service_month = @month AND day_of_week = @dow
  `);
  return new Set(result.recordset.map((row) => `${row.route_id}-${row.stop_id}`));
}

/**
 * Take the snapshot for one exclusion, replacing anything already stored for
 * it. Returns what was frozen, or why it refused.
 *
 * Re-approving re-reads the feed. That is deliberate: a date approved, then
 * reverted, then approved again should carry today's evidence rather than a
 * stale copy, and the `snapshot_taken_at` stamp says which read it was.
 */
export async function takeDateExclusionSnapshot(
  executor: Executor,
  exclusionId: string,
  serviceDate: string,
  routeId: number | null,
): Promise<SnapshotOutcome> {
  const serviceMonth = serviceMonthOfDate(serviceDate);
  const dayOfWeek = availDayOfWeek(serviceDate);

  const monthlyKeys = await readMonthlyKeys(executor, serviceMonth, dayOfWeek);
  if (monthlyKeys.size === 0) return { kind: "refused", reason: { kind: "day_of_week_absent", dayOfWeek } };

  const departures = await readDateDepartures(executor, serviceDate, routeId);
  if (departures.length === 0) return { kind: "refused", reason: { kind: "no_daily_data" } };

  const rows = matchable(departures, monthlyKeys);
  if (rows.length === 0) return { kind: "refused", reason: { kind: "nothing_to_subtract" } };

  await request(executor).input("id", sql.UniqueIdentifier, exclusionId)
    .query("DELETE FROM dbo.OtpDateExclusionDepartures WHERE exclusion_id = @id");

  for (const row of rows) {
    const insert = request(executor);
    insert.input("id", sql.UniqueIdentifier, exclusionId);
    insert.input("month", sql.Char(6), serviceMonth);
    insert.input("route", sql.Int, row.route_id);
    insert.input("stop", sql.Int, row.stop_id);
    insert.input("dow", sql.NVarChar(20), dayOfWeek);
    insert.input("total", sql.Int, row.total);
    insert.input("ontime", sql.Int, row.ontime);
    insert.input("early", sql.Int, row.early);
    insert.input("late", sql.Int, row.late);
    insert.input("missed", sql.Int, row.missed);
    await insert.query(`
      INSERT INTO dbo.OtpDateExclusionDepartures
        (exclusion_id, service_month, route_id, stop_id, day_of_week, total, ontime, early, late, missed)
      VALUES (@id, @month, @route, @stop, @dow, @total, @ontime, @early, @late, @missed)
    `);
  }

  return {
    kind: "taken",
    serviceMonth,
    dayOfWeek,
    rows: rows.length,
    departures: rows.reduce((sum, row) => sum + row.total, 0),
  };
}
