// Detour status (Active/Upcoming/Monitor/Recently finished/Expired) is
// deliberately never a stored column (migration-017's own comment) - it must
// be identical whether it's driving the console's status tabs or any future
// "active detours only" query, so it lives in exactly one place: this pure
// function. Dates are compared as plain YYYY-MM-DD strings - no timezone
// math needed, since a detour's start/end date is a service-day concept,
// not a timestamp.
//
// THE CATCH THIS FILE ORIGINALLY GOT WRONG: an earlier version of this
// comment claimed "SQL DATE columns serialize this way". They do not. The
// mssql driver hands back a JS Date object for a DATE column, and every
// comparison below then ran string-against-Date, which coerces to NaN and
// is false in BOTH directions - so `today < start_date` and
// `today <= end_date` were both false for every row on earth, and every
// detour fell through to "recently_finished" regardless of its dates. That
// shipped, and it is why the console showed no Active detours at all. Hence
// toDateOnly() below: normalize first, compare second.
export type DetourStatus = "monitor" | "upcoming" | "active" | "recently_finished" | "expired";

// Accepts whatever the DB driver actually produced - a Date, an ISO
// timestamp string, or an already-plain YYYY-MM-DD string - and reduces it
// to the date-only form the comparisons below require. UTC throughout: a
// DATE column has no time or zone, and reading it in local time can shift
// it a day.
export function toDateOnly(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string" || value === "") return null;
  // Already date-only, or an ISO timestamp whose first 10 chars are the date.
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export interface DetourStatusInput {
  start_date: Date | string | null;
  end_date: Date | string | null;
  is_monitor_only: boolean;
}

// A detour stays "recently finished" for this many days after its end_date
// before rolling into "expired" - long enough that staff reviewing the
// week's closures still see it, short enough that the Expired tab doesn't
// flood with things nobody needs to look at anymore. Tunable later.
export const RECENTLY_FINISHED_WINDOW_DAYS = 7;

function todayIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// today is injectable for tests; defaults to the real current date.
export function computeDetourStatus(d: DetourStatusInput, today: string = todayIso()): DetourStatus {
  if (d.is_monitor_only) return "monitor";

  const startDate = toDateOnly(d.start_date);
  const endDate = toDateOnly(d.end_date);

  if (!startDate) return "active"; // no dates recorded at all - safest default for a real (non-monitor) closure

  if (today < startDate) return "upcoming";

  if (!endDate || today <= endDate) return "active"; // open-ended, or still within range

  return today <= addDaysIso(endDate, RECENTLY_FINISHED_WINDOW_DAYS) ? "recently_finished" : "expired";
}

export const DETOUR_STATUS_LABELS: Record<DetourStatus, string> = {
  monitor: "Monitor",
  upcoming: "Upcoming",
  active: "Active",
  recently_finished: "Recently finished",
  expired: "Expired",
};
