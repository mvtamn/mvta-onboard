// Corrective action that turns on a rolling window.
//
// "CAP if more than 5 preventable collisions in a rolling 30 days" and "CAP
// after 3+ incident-reporting failures in 30 days" are not properties of a
// penalty band: they are counts over a window that slides, and that crosses
// month boundaries. `triggers_cap` sits on a band and is matched one
// occurrence at a time, so it could never see either rule.
//
// The window is evaluated over occurrences from BEFORE the period as well,
// which is the whole point of "rolling" - five collisions spread over the last
// week of March and the first week of April breach a 30-day rule that neither
// month breaches on its own.

export interface WindowedOccurrence {
  /** CHAR(8) YYYYMMDD. */
  serviceDate: string;
  quantity: number;
}

// How the window is counted.
//
// rolling_days      any span of N days, sliding. "More than 5 in a rolling 30
//                   days" catches a run that straddles a month end, which is
//                   the point of writing the rule that way.
// calendar_quarter  Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec. "3+ repeat cases per
//                   quarter" means the quarter as the contract's own reporting
//                   period, and the count resets at the boundary.
//
// The two genuinely differ, and not only at the edges: three cases in December
// and three in January breach a calendar-quarter rule never, and a rolling
// 90-day rule almost certainly. Which one the contract means is a reading of
// the contract, so it is recorded per standard rather than assumed.
export type CapWindowMode = "rolling_days" | "calendar_quarter";

export interface CapWindowRule {
  mode?: CapWindowMode;
  /** Required for rolling_days; ignored for calendar_quarter. */
  windowDays?: number;
  threshold: number;
}

export interface CapWindowBreach {
  /** The occurrence date the window ends on. */
  endedOn: string;
  startedOn: string;
  count: number;
}

function toDate(serviceDate: string): number {
  return Date.UTC(
    Number(serviceDate.slice(0, 4)),
    Number(serviceDate.slice(4, 6)) - 1,
    Number(serviceDate.slice(6, 8)),
  );
}

function toServiceDate(time: number): string {
  const date = new Date(time);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}`;
}

// The first window in which the count exceeds the threshold, or null.
//
// "More than 5 in 30 days" means the sixth occurrence inside the window
// breaches - the threshold is the number tolerated, not the number that
// triggers. Each occurrence's own date ends a window looking back windowDays,
// inclusive of both ends, because that is how a person reading the contract
// counts it.
function quarterOf(serviceDate: string): { year: number; quarter: number } {
  const year = Number(serviceDate.slice(0, 4));
  return { year, quarter: Math.floor((Number(serviceDate.slice(4, 6)) - 1) / 3) + 1 };
}

function quarterBounds(year: number, quarter: number): { startedOn: string; endedOn: string } {
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  return {
    startedOn: `${year}${String(firstMonth).padStart(2, "0")}01`,
    endedOn: `${year}${String(lastMonth).padStart(2, "0")}${String(lastDay).padStart(2, "0")}`,
  };
}

// The first calendar quarter whose count exceeds the threshold.
function findCalendarQuarterBreach(
  ordered: readonly WindowedOccurrence[],
  threshold: number,
): CapWindowBreach | null {
  const counts = new Map<string, number>();
  for (const occurrence of ordered) {
    const { year, quarter } = quarterOf(occurrence.serviceDate);
    const key = `${year}-${quarter}`;
    const count = (counts.get(key) ?? 0) + Math.max(1, Math.round(occurrence.quantity || 1));
    counts.set(key, count);
    if (count > threshold) {
      const bounds = quarterBounds(year, quarter);
      return { ...bounds, count };
    }
  }
  return null;
}

export function findCapWindowBreach(
  occurrences: readonly WindowedOccurrence[],
  rule: CapWindowRule,
): CapWindowBreach | null {
  if (!(rule.threshold > 0)) return null;
  const mode = rule.mode ?? "rolling_days";
  if (mode === "rolling_days" && !(rule.windowDays && rule.windowDays > 0)) return null;
  const ordered = [...occurrences]
    .filter((occurrence) => /^\d{8}$/.test(occurrence.serviceDate))
    .sort((left, right) => left.serviceDate.localeCompare(right.serviceDate));
  if (mode === "calendar_quarter") return findCalendarQuarterBreach(ordered, rule.threshold);
  const spanMs = ((rule.windowDays ?? 0) - 1) * 24 * 60 * 60 * 1000;

  for (let end = 0; end < ordered.length; end += 1) {
    const endTime = toDate(ordered[end].serviceDate);
    const startTime = endTime - spanMs;
    let count = 0;
    for (let index = end; index >= 0; index -= 1) {
      if (toDate(ordered[index].serviceDate) < startTime) break;
      // An occurrence can carry a quantity above one, and the contract counts
      // events rather than rows.
      count += Math.max(1, Math.round(ordered[index].quantity || 1));
    }
    if (count > rule.threshold) {
      return { endedOn: ordered[end].serviceDate, startedOn: toServiceDate(startTime), count };
    }
  }
  return null;
}

export function describeCapWindowBreach(breach: CapWindowBreach, rule: CapWindowRule): string {
  const period = (rule.mode ?? "rolling_days") === "calendar_quarter"
    ? "that calendar quarter"
    : `any ${rule.windowDays} days`;
  return `${breach.count} occurrences between ${breach.startedOn} and ${breach.endedOn} exceed the ${rule.threshold} tolerated in ${period}.`;
}
