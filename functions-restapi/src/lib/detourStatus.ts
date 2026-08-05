// Detour status (Active/Upcoming/Monitor/Recently finished/Expired) is
// deliberately never a stored column (migration-017's own comment) - it must
// be identical whether it's driving the console's status tabs or any future
// "active detours only" query, so it lives in exactly one place: this pure
// function. Dates are compared as plain YYYY-MM-DD strings (SQL DATE columns
// serialize this way) - no timezone math needed since a detour's start/end
// date is a service-day concept, not a timestamp.
export type DetourStatus = "monitor" | "upcoming" | "active" | "recently_finished" | "expired";

export interface DetourStatusInput {
  start_date: string | null;
  end_date: string | null;
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

  if (!d.start_date) return "active"; // no dates recorded at all - safest default for a real (non-monitor) closure

  if (today < d.start_date) return "upcoming";

  if (!d.end_date || today <= d.end_date) return "active"; // open-ended, or still within range

  return today <= addDaysIso(d.end_date, RECENTLY_FINISHED_WINDOW_DAYS) ? "recently_finished" : "expired";
}

export const DETOUR_STATUS_LABELS: Record<DetourStatus, string> = {
  monitor: "Monitor",
  upcoming: "Upcoming",
  active: "Active",
  recently_finished: "Recently finished",
  expired: "Expired",
};
