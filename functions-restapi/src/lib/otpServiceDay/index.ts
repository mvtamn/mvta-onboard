// Days that did not run a normal schedule, and what they do to a day-of-week
// bucket (ADR 0040).
//
// Avail's monthly OTP feed groups by day of week, so September's Mon row is
// every Monday added together - including Labor Day, which ran a Sunday-level
// schedule. A reader comparing Mondays is comparing three Mondays and a Sunday
// wearing a Monday's name. The Review Queue is the sharpest case: a Flagged
// Stop is decided from a stop's early and late shares per day of week, so a
// holiday inside the bucket can make an ordinary stop look biased.
//
// A day is DECLARED, never inferred. Detecting these from the daily feed was
// tried and rejected: the feed keeps 90 days and held nothing before
// 2026-09-14, so it cannot see the day that prompted any of this. The daily
// feed corroborates a declaration where it has the date and never decides it,
// the same relationship ADR 0035 set up between Avail and a missed-trip case.
//
// Declaring a day changes no figure. Taking a day out of the contractor's
// figure is a Weather/Emergency date exclusion, approved on its own evidence
// (ADR 0038) - a separate and deliberate act.
import { sql } from "../db";
import { availDayOfWeek, serviceMonthOfDate } from "../otpMonth/rules";
import type { Executor } from "../otpMonth";
import type { ReducedServiceDay, ReducedServiceDayEvidence, ReducedServiceCoverage } from "./types";

export * from "./types";

const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

/**
 * The share of a normal day's departures at or above which a declared day is
 * not, in any useful sense, reduced.
 *
 * Not a tuned figure, and it does not need to be. The two populations are far
 * apart: on dev, ordinary Monday-to-Monday variation was under 2% (2,548 vs
 * 2,601), while Labor Day's Sunday-level service ran at 41% of a Monday.
 * Anything above 90% of its neighbours ran a normal schedule, whatever the
 * declaration says.
 */
export const REDUCED_SERVICE_SHARE = 0.9;

/** At least this many comparable dates, or the feed cannot say anything. */
export const MIN_COMPARISON_DATES = 2;

/** A date's departures, as the daily feed holds them. */
export interface DailyDateTotal {
  service_date: string;
  day_of_week: string;
  departures: number;
}

/** The middle value, averaging the two middles for an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * What the daily feed says about one declared day.
 *
 * `typical` is the median of the same day of week in the same month, over the
 * dates the feed covers, with every declared day removed - including this one.
 * Median rather than mean so a second holiday in the bucket cannot drag the
 * comparison toward itself.
 */
export function evidenceFor(
  day: Pick<ReducedServiceDay, "service_date" | "day_of_week">,
  dailyTotals: readonly DailyDateTotal[],
  declaredDates: ReadonlySet<string>,
): ReducedServiceDayEvidence {
  const month = serviceMonthOfDate(day.service_date);
  const own = dailyTotals.find((total) => total.service_date === day.service_date);

  const peers = dailyTotals
    .filter((total) =>
      total.day_of_week === day.day_of_week &&
      serviceMonthOfDate(total.service_date) === month &&
      !declaredDates.has(total.service_date))
    .map((total) => total.departures);

  if (!own) return { service_date: day.service_date, coverage: "no_daily_data", departures: null, typical: null, share: null };
  if (peers.length < MIN_COMPARISON_DATES) {
    return { service_date: day.service_date, coverage: "insufficient_comparison", departures: own.departures, typical: null, share: null };
  }

  const typical = median(peers);
  if (typical === null || typical <= 0) {
    return { service_date: day.service_date, coverage: "insufficient_comparison", departures: own.departures, typical: null, share: null };
  }

  const share = own.departures / typical;
  // Contradicted is the useful half of this: somebody may have declared the
  // wrong date, and a day running a full schedule under a holiday label is
  // exactly what nobody would otherwise notice.
  const coverage: ReducedServiceCoverage = share < REDUCED_SERVICE_SHARE ? "corroborated" : "contradicted";
  return { service_date: day.service_date, coverage, departures: own.departures, typical, share };
}

/** The day-of-week buckets a month's declared days land in, each named once. */
export function affectedDayOfWeek(days: readonly ReducedServiceDay[]): string[] {
  return [...new Set(days.map((day) => day.day_of_week))];
}

/**
 * Whether the feed is complete enough for a declaration's evidence to mean
 * anything at all. Reported so a reviewer is told "the feed does not cover
 * this month" rather than being shown a blank where a corroboration should be.
 */
export function anyEvidence(evidence: readonly ReducedServiceDayEvidence[]): boolean {
  return evidence.some((item) => item.coverage === "corroborated" || item.coverage === "contradicted");
}

/** The declared days whose service date falls in one month. */
export async function readReducedServiceDays(executor: Executor, month: string): Promise<ReducedServiceDay[]> {
  const req = request(executor);
  req.input("month", sql.Char(6), month);
  const result = await req.query<ReducedServiceDay>(`
    SELECT id, service_date, day_of_week, label, schedule_operated, notes, declared_by, declared_at
    FROM dbo.OtpReducedServiceDays
    WHERE LEFT(service_date, 6) = @month
    ORDER BY service_date
  `);
  return result.recordset;
}

/** Departures per date in one month, from the daily feed. */
export async function readDailyDateTotals(executor: Executor, month: string): Promise<DailyDateTotal[]> {
  const req = request(executor);
  req.input("month", sql.Char(6), month);
  const result = await req.query<{ service_date: string; departures: number }>(`
    SELECT calendar_date service_date, SUM(ISNULL(total, 0)) departures
    FROM dbo.OtpDailyRouteStopHour
    WHERE LEFT(calendar_date, 6) = @month
    GROUP BY calendar_date
    HAVING SUM(ISNULL(total, 0)) > 0
  `);
  return result.recordset.map((row) => ({
    service_date: row.service_date,
    day_of_week: availDayOfWeek(row.service_date),
    departures: Number(row.departures),
  }));
}

export interface ReducedServiceMonth {
  days: ReducedServiceDay[];
  evidence: ReducedServiceDayEvidence[];
  /** The day-of-week buckets a reader should not compare naively. */
  affected_day_of_week: string[];
}

/**
 * A month's declared days with whatever the daily feed can say about each.
 *
 * Returns nothing rather than failing when migration 142 has not run: a
 * missing table means nobody has declared anything, which is indistinguishable
 * from an ordinary month and is the safe reading.
 */
export async function readReducedServiceMonth(executor: Executor, month: string): Promise<ReducedServiceMonth> {
  const ready = (await request(executor).query<{ declared: number; daily: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.OtpReducedServiceDays','U') IS NULL THEN 0 ELSE 1 END declared,
           CASE WHEN OBJECT_ID('dbo.OtpDailyRouteStopHour','U') IS NULL THEN 0 ELSE 1 END daily
  `)).recordset[0];
  if (ready?.declared !== 1) return { days: [], evidence: [], affected_day_of_week: [] };

  const days = await readReducedServiceDays(executor, month);
  if (days.length === 0) return { days: [], evidence: [], affected_day_of_week: [] };

  const totals = ready.daily === 1 ? await readDailyDateTotals(executor, month) : [];
  const declaredDates = new Set(days.map((day) => day.service_date));
  return {
    days,
    evidence: days.map((day) => evidenceFor(day, totals, declaredDates)),
    affected_day_of_week: affectedDayOfWeek(days),
  };
}
