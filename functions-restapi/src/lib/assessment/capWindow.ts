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

export interface CapWindowRule {
  windowDays: number;
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
export function findCapWindowBreach(
  occurrences: readonly WindowedOccurrence[],
  rule: CapWindowRule,
): CapWindowBreach | null {
  if (!(rule.windowDays > 0) || !(rule.threshold > 0)) return null;
  const ordered = [...occurrences]
    .filter((occurrence) => /^\d{8}$/.test(occurrence.serviceDate))
    .sort((left, right) => left.serviceDate.localeCompare(right.serviceDate));
  const spanMs = (rule.windowDays - 1) * 24 * 60 * 60 * 1000;

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
  return `${breach.count} occurrences between ${breach.startedOn} and ${breach.endedOn} exceed the ${rule.threshold} tolerated in any ${rule.windowDays} days.`;
}
