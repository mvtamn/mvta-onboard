import type { ReducedServiceDayEvidence, ReducedServiceMonth } from "@mvta/shared";

// What to tell a reviewer about a month's declared reduced-service days
// (ADR 0040).
//
// The figures are grouped by day of week, so a holiday running a Sunday
// timetable is added into that weekday's bucket. Naming it is the entire point
// of the feature: a Monday bucket containing Labor Day is three Mondays and a
// Sunday, and a stop can look biased on Mondays because of it.

/** "Mon" -> "Monday", for a sentence rather than a column heading. */
const FULL_DAY: Record<string, string> = {
  Sun: "Sunday", Mon: "Monday", Tues: "Tuesday", Wed: "Wednesday",
  Thur: "Thursday", Fri: "Friday", Sat: "Saturday",
};

export const dayName = (dayOfWeek: string): string => FULL_DAY[dayOfWeek] ?? dayOfWeek;

/** "YYYYMMDD" -> "MM/DD", which is enough inside a month's own page. */
export const shortDate = (serviceDate: string): string =>
  `${serviceDate.slice(4, 6)}/${serviceDate.slice(6, 8)}`;

/** Joins names the way a sentence does: "Monday and Thursday". */
export function listDays(dayOfWeek: readonly string[]): string {
  const names = dayOfWeek.map(dayName);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What the daily feed adds about one day, if anything.
 *
 * Silence is deliberate where the feed cannot speak: showing "no data" against
 * every day would bury the corroborations that do exist, and the declaration
 * stands on the agency's own knowledge either way.
 */
export function evidenceText(evidence: ReducedServiceDayEvidence | undefined): string | null {
  if (!evidence) return null;
  switch (evidence.coverage) {
    case "corroborated":
      return evidence.share === null ? null
        : `ran ${Math.round(evidence.share * 100)}% of a normal day's departures`;
    case "contradicted":
      // The finding, and the reason it is worded as a question rather than a
      // fact: the declaration may be right and the date wrong.
      return evidence.share === null ? null
        : `ran ${Math.round(evidence.share * 100)}% of a normal day's departures — check the date`;
    case "no_daily_data":
    case "insufficient_comparison":
      return null;
  }
}

export interface ReducedServiceNote {
  /** The sentence naming which buckets are affected. */
  headline: string;
  /** One line per declared day, with evidence where the feed has it. */
  days: string[];
}

/**
 * The note, or null when the month has no declared days - in which case
 * nothing should be shown at all rather than an empty reassurance.
 */
export function reducedServiceNote(month: ReducedServiceMonth | null | undefined): ReducedServiceNote | null {
  if (!month || month.days.length === 0) return null;

  const evidenceByDate = new Map(month.evidence.map((item) => [item.service_date, item]));
  const buckets = listDays(month.affected_day_of_week);
  const plural = month.days.length === 1 ? "day" : "days";

  return {
    headline: `This month's ${buckets} figures include ${month.days.length} ${plural} that did not run a normal schedule. Avail groups by day of week, so ${month.days.length === 1 ? "it is" : "they are"} added into that bucket.`,
    days: month.days.map((day) => {
      const evidence = evidenceText(evidenceByDate.get(day.service_date));
      const base = `${shortDate(day.service_date)} — ${day.label}, ${day.schedule_operated}`;
      return evidence ? `${base} (${evidence})` : base;
    }),
  };
}
