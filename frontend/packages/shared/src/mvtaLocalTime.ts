// MVTA-local time, meaning America/Chicago, wherever the browser happens to be.
//
// Event Plan operating periods were round-tripped entirely in the BROWSER's
// zone - `new Date("YYYY-MM-DDTHH:mm")` to store, `getTimezoneOffset()` to put
// back in the form, `toLocaleString()` to display - under copy that says
// "Times use MVTA-local time". On a machine not set to Central that label is
// simply false: a planner types 18:00 meaning six in the evening at the garage
// and stores six in the evening wherever they are sitting. Nothing warns them,
// because every later read applies the same wrong offset and looks consistent.
//
// Dispatch Log hit this first and fixed it the same way (AGENCY_TIME_ZONE,
// v1.5.312): the agency clock is a property of the agency, not of the viewer.

export const MVTA_TIME_ZONE = "America/Chicago";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: MVTA_TIME_ZONE,
  hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** The wall clock MVTA reads at this instant, as numbers. */
function wallClockAt(instant: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts: Record<string, string> = {};
  for (const part of PARTS.formatToParts(instant)) if (part.type !== "literal") parts[part.type] = part.value;
  // Intl gives midnight as hour 24 in some runtimes; 24:00 is 00:00 next day,
  // and Date.UTC normalizes that, so it is left alone deliberately.
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

/** How far MVTA's clock is from UTC at this instant, in ms (CST -6h, CDT -5h). */
function offsetAt(instant: Date): number {
  const w = wallClockAt(instant);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - instant.getTime();
}

/** A `YYYY-MM-DDTHH:mm` wall clock, as the form holds it. */
export type MvtaWallClock = string;

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * The instant at which MVTA's clock reads this wall clock.
 *
 * Twice a year a wall clock is not one instant, and the offset has to be
 * resolved against the answer rather than the question:
 *
 *   Spring forward - 02:30 on the second Sunday in March never happens. It
 *   resolves to 03:30 CDT, the same instant the hour would have reached, which
 *   is what a service window written across the gap means.
 *   Fall back - 01:30 on the first Sunday in November happens twice. It
 *   resolves to the FIRST, still on CDT, so an evening period does not
 *   silently gain an hour.
 *
 * Returns null for anything that is not a wall clock; the caller decides what
 * an unparseable period means.
 */
export function mvtaLocalToInstant(wall: MvtaWallClock): Date | null {
  const match = WALL.exec(wall.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, se] = match;
  const asIfUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? "0"));
  if (Number.isNaN(asIfUtc)) return null;
  // The shape matching is not the same as the parts being real: Date.UTC rolls
  // month 99 over into 2034 rather than refusing it, and day 32 into the next
  // month. Reading the parts back is what makes an impossible date a refusal.
  const checked = new Date(asIfUtc);
  if (checked.getUTCFullYear() !== Number(y) || checked.getUTCMonth() !== Number(mo) - 1 || checked.getUTCDate() !== Number(d)
    || checked.getUTCHours() !== Number(h) || checked.getUTCMinutes() !== Number(mi)) return null;

  // First guess: the offset in force around that date. Then check the answer -
  // across a transition the offset at the resulting instant differs, and it is
  // the one at the instant that is correct.
  const first = new Date(asIfUtc - offsetAt(new Date(asIfUtc)));
  if (instantReadsAs(first, match)) return first;
  const second = new Date(asIfUtc - offsetAt(first));
  if (instantReadsAs(second, match)) return second;
  // Neither reads back: the wall clock is inside the spring-forward gap. The
  // first candidate is the instant the clock jumps to, which is the sense a
  // period written across the gap is meant in.
  return first;
}

function instantReadsAs(instant: Date, match: RegExpExecArray): boolean {
  const w = wallClockAt(instant);
  const [, y, mo, d, h, mi, se] = match;
  return w.year === Number(y) && w.month === Number(mo) && w.day === Number(d)
    && w.hour === Number(h) && w.minute === Number(mi) && w.second === Number(se ?? "0");
}

/** The `YYYY-MM-DDTHH:mm` MVTA's clock reads at this instant, for a form. */
export function instantToMvtaLocal(value: string | Date | null | undefined): MvtaWallClock {
  if (!value) return "";
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const w = wallClockAt(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** An instant written for people, on the agency clock, never the browser's. */
export function formatMvtaLocal(value: string | Date | null | undefined): string {
  if (!value) return "";
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  return instant.toLocaleString("en-US", {
    timeZone: MVTA_TIME_ZONE,
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
