// What Avail observed at each of a route's timepoints, by hour, laid beside
// what the schedule says (plans/schedule-review-module-plan.md section 9).
//
// Increment 2 shows that route 420 is scheduled the same 10 minutes from 157th
// Street Station to Apple Valley TS at every hour. Whether that is wrong is a
// question for the buses: if departures at Apple Valley run 38% late at 4-6pm
// and 11% early at 10am-2pm, the flat running time is the cause. Avail already
// measures this, per route, stop, hour and service day (OtpDailyRouteStopHour).
//
// Not compliance. These are Avail's early/on-time/late counts as Avail
// classified them, over whatever window the reader picked: not the Official
// Departure OTP figure, no stop or date exclusions, nothing from lib/otpMonth.
// The one rule here turns a flat segment plus a peak late share into a
// sentence that is evidence for a schedule change, never the change.
//
// Pure: aggregated rows in, grid and readings out. observedStore.ts reads the
// rows; this file reads nothing.
import { PEAK_HOURS } from "./feedModel";
import type { TimepointSegmentDetail } from "./types";

export type ObservedDayKind = "weekday" | "saturday" | "sunday";

/** One (stop, direction, hour) over the window, as the store sums it. */
export interface ObservedRow {
  stop_id: string;
  stop_name: string | null;
  direction: string | null;
  hour_of_day: number;
  early: number;
  ontime: number;
  late: number;
  total: number;
}

export interface ObservedCell {
  hour: number;
  departures: number;
  early_pct: number;
  ontime_pct: number;
  late_pct: number;
}

export interface ObservedTimepoint {
  stop_id: string;
  stop_name: string;
  /** Avail's direction label for the row; a station served both ways is two rows. */
  direction: string | null;
  departures: number;
  /** In the schedule's segment order; stops the schedule has no timepoint for come last. */
  in_schedule: boolean;
  hours: ObservedCell[];
}

export type ObservedReadingKind = "peak_under_run" | "off_peak_over_run";
export type ObservedPeriod = "am" | "pm" | "midday";

/** A flat segment whose downstream timepoint shows the signature of a wrong running time. */
export interface ObservedReading {
  kind: ObservedReadingKind;
  /** am / pm: that peak is under-run. midday: midday is over-run. */
  period: ObservedPeriod;
  /** The segment's direction (N, S, E, W), or null when it was read across both. */
  direction: string | null;
  from_stop_id: string;
  to_stop_id: string;
  from_stop_name: string;
  to_stop_name: string;
  scheduled_minutes: number;
  /** Late share in the peak (under-run) or early share in the peak (over-run) at the downstream timepoint. */
  peak_pct: number;
  /** The same share at midday. */
  off_peak_pct: number;
  /** Under-run only: the late share at the upstream timepoint in the same peak; null when it is not measured. */
  upstream_pct: number | null;
  text: string;
}

export interface ObservedWindow {
  days: number;
  dow: ObservedDayKind;
  first_day: string | null;
  last_day: string | null;
  service_days: number;
}

export interface ObservedOtp {
  window: ObservedWindow;
  departures: number;
  timepoints: ObservedTimepoint[];
  readings: ObservedReading[];
}

// Tuned on the live September-October 2026 weekday data across the twelve
// routes with flat schedules (plans/schedule-review-module-plan.md section 10).
// The first rule pooled both directions at the downstream stop and called
// every hour outside the peak "off-peak", so the evening tail of a PM peak and
// a well-run opposite direction both diluted the gap: it found nothing on 420
// although 157th Street westbound departs 46% late 3-7pm and 4% midday.

/** The peaks a reading compares with midday. The hour is the hour a bus departed the timepoint. */
export const AM_PEAK_HOURS: ReadonlySet<number> = new Set([6, 7, 8]);
export const PM_PEAK_HOURS: ReadonlySet<number> = new Set([15, 16, 17, 18]);
/** The base. 9am and the evening are shoulders: lateness there is often carried over from the peak. */
export const MIDDAY_HOURS: ReadonlySet<number> = new Set([10, 11, 12, 13, 14]);

/** Points by which a peak's share must exceed midday's before a reading is made. */
export const READING_MIN_POINT_GAP = 15;
/** Departures each side needs before a share means anything. */
export const READING_MIN_DEPARTURES = 20;
/**
 * Points the late share must rise between the upstream and the downstream
 * timepoint in that peak, so the reading names the segment where lateness is
 * added rather than one that only carries it on.
 */
export const READING_MIN_ADDED_POINTS = 10;

const PERIOD_WORDS: Record<ObservedPeriod, string> = { am: "6–9am", pm: "3–7pm", midday: "10am–3pm" };
const DIRECTION_WORDS: Record<string, string> = { N: "northbound", S: "southbound", E: "eastbound", W: "westbound" };

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((100 * part) / whole);
}

/**
 * The same test the console's grid uses for "same all day": at least three
 * start hours, some in the peak and some out of it, all with one value.
 */
export function isFlatSegment(segment: TimepointSegmentDetail): boolean {
  if (segment.hours.length < 3) return false;
  const spansPeak = segment.hours.some((h) => PEAK_HOURS.has(h.hour));
  const spansOffPeak = segment.hours.some((h) => !PEAK_HOURS.has(h.hour));
  if (!spansPeak || !spansOffPeak) return false;
  const first = segment.hours[0];
  return segment.hours.every((h) => h.min_minutes === first.min_minutes && h.max_minutes === first.min_minutes);
}

/** Timepoint stop ids in the order the schedule's segments visit them. */
function scheduleOrder(segments: TimepointSegmentDetail[]): Map<string, { order: number; name: string }> {
  const order = new Map<string, { order: number; name: string }>();
  for (const segment of segments) {
    if (!order.has(segment.from_stop_id)) order.set(segment.from_stop_id, { order: order.size, name: segment.from_stop_name });
    if (!order.has(segment.to_stop_id)) order.set(segment.to_stop_id, { order: order.size, name: segment.to_stop_name });
  }
  return order;
}

export function summarizeObserved(
  rows: readonly ObservedRow[],
  segments: readonly TimepointSegmentDetail[],
  window: ObservedWindow,
): ObservedOtp {
  const order = scheduleOrder([...segments]);
  const byStop = new Map<string, ObservedTimepoint>();
  for (const row of rows) {
    if (row.total <= 0) continue;
    const key = `${row.stop_id}\u0000${row.direction ?? ""}`;
    let tp = byStop.get(key);
    if (!tp) {
      tp = {
        stop_id: row.stop_id,
        stop_name: order.get(row.stop_id)?.name ?? row.stop_name ?? row.stop_id,
        direction: row.direction,
        departures: 0,
        in_schedule: order.has(row.stop_id),
        hours: [],
      };
      byStop.set(key, tp);
    }
    tp.departures += row.total;
    tp.hours.push({
      hour: row.hour_of_day,
      departures: row.total,
      early_pct: pct(row.early, row.total),
      ontime_pct: pct(row.ontime, row.total),
      late_pct: pct(row.late, row.total),
    });
  }
  const timepoints = [...byStop.values()]
    .map((tp) => ({ ...tp, hours: tp.hours.sort((a, b) => a.hour - b.hour) }))
    .sort((a, b) =>
      Number(b.in_schedule) - Number(a.in_schedule) ||
      (order.get(a.stop_id)?.order ?? Infinity) - (order.get(b.stop_id)?.order ?? Infinity) ||
      a.stop_name.localeCompare(b.stop_name) ||
      (a.direction ?? "").localeCompare(b.direction ?? ""));

  return {
    window,
    departures: timepoints.reduce((sum, tp) => sum + tp.departures, 0),
    timepoints,
    readings: readings(rows, segments),
  };
}

interface Side { departures: number; early: number; late: number }

function band(rows: readonly ObservedRow[], hours: ReadonlySet<number>): Side {
  const side: Side = { departures: 0, early: 0, late: 0 };
  for (const row of rows) {
    if (row.total <= 0 || !hours.has(row.hour_of_day)) continue;
    side.departures += row.total;
    side.early += row.early;
    side.late += row.late;
  }
  return side;
}

/** Avail's direction labels are N/S/E/W; compare on the first letter in case a feed spells them out. */
function sameDirection(avail: string | null, segment: string): boolean {
  return (avail ?? "").trim().charAt(0).toUpperCase() === segment;
}

/**
 * The rows Avail measured at a stop for the segment's direction. Read across
 * both directions only when the segment has no direction, or when Avail gives
 * no direction at that stop.
 */
function rowsAt(rows: readonly ObservedRow[], stopId: string, direction: string | null): { rows: ObservedRow[]; direction: string | null } {
  const atStop = rows.filter((row) => row.stop_id === stopId);
  if (direction && atStop.some((row) => row.direction)) {
    return { rows: atStop.filter((row) => sameDirection(row.direction, direction)), direction };
  }
  return { rows: atStop, direction: null };
}

function segmentWords(segment: TimepointSegmentDetail, direction: string | null): string {
  const way = direction ? DIRECTION_WORDS[direction] : null;
  return `${segment.from_stop_name} → ${segment.to_stop_name}${way ? ` (${way})` : ""}`;
}

/**
 * Readings for every flat segment whose downstream timepoint tells on it:
 *
 *  - Peak under-run: departures there run late in the AM or PM peak by at
 *    least READING_MIN_POINT_GAP points more than at midday, AND the late share
 *    rises across the segment by READING_MIN_ADDED_POINTS (lateness added here,
 *    not carried in). When the upstream timepoint is not measured the reading
 *    is kept and says so.
 *  - Midday over-run: departures run early at midday by the same gap more than
 *    in the peaks.
 *
 * Each direction is read on its own; one reading per segment and period.
 */
export function readings(rows: readonly ObservedRow[], segments: readonly TimepointSegmentDetail[]): ObservedReading[] {
  const out: ObservedReading[] = [];
  for (const segment of segments) {
    if (!isFlatSegment(segment)) continue;
    const to = rowsAt(rows, segment.to_stop_id, segment.direction ?? null);
    const from = rowsAt(rows, segment.from_stop_id, to.direction);
    const midday = band(to.rows, MIDDAY_HOURS);
    if (midday.departures < READING_MIN_DEPARTURES) continue;
    const minutes = segment.hours[0].min_minutes;
    const middayLate = pct(midday.late, midday.departures);
    const middayEarly = pct(midday.early, midday.departures);
    const where = segmentWords(segment, to.direction);
    const base = {
      direction: to.direction,
      from_stop_id: segment.from_stop_id,
      to_stop_id: segment.to_stop_id,
      from_stop_name: segment.from_stop_name,
      to_stop_name: segment.to_stop_name,
      scheduled_minutes: minutes,
    };

    for (const [period, hours] of [["am", AM_PEAK_HOURS], ["pm", PM_PEAK_HOURS]] as const) {
      const peak = band(to.rows, hours);
      if (peak.departures < READING_MIN_DEPARTURES) continue;
      const peakLate = pct(peak.late, peak.departures);
      if (peakLate - middayLate < READING_MIN_POINT_GAP) continue;
      const upstream = band(from.rows, hours);
      const upstreamLate = upstream.departures >= READING_MIN_DEPARTURES ? pct(upstream.late, upstream.departures) : null;
      if (upstreamLate !== null && peakLate - upstreamLate < READING_MIN_ADDED_POINTS) continue;
      const label = period === "am" ? "AM" : "PM";
      out.push({
        ...base,
        kind: "peak_under_run",
        period,
        peak_pct: peakLate,
        off_peak_pct: middayLate,
        upstream_pct: upstreamLate,
        text: `${where}: scheduled ${minutes} min at every hour; departures from ${segment.to_stop_name} run ${peakLate}% late ${PERIOD_WORDS[period]} against ${middayLate}% midday, ` +
          (upstreamLate === null
            ? `and the timepoint before it is not measured, so some of that may come from earlier in the trip. The ${label} peak looks under-run.`
            : `up from ${upstreamLate}% at ${segment.from_stop_name}. The ${label} peak is under-run.`),
      });
    }

    const peaks = band(to.rows, new Set([...AM_PEAK_HOURS, ...PM_PEAK_HOURS]));
    if (peaks.departures >= READING_MIN_DEPARTURES) {
      const peakEarly = pct(peaks.early, peaks.departures);
      if (middayEarly - peakEarly >= READING_MIN_POINT_GAP) {
        out.push({
          ...base,
          kind: "off_peak_over_run",
          period: "midday",
          peak_pct: peakEarly,
          off_peak_pct: middayEarly,
          upstream_pct: null,
          text: `${where}: scheduled ${minutes} min at every hour; departures from ${segment.to_stop_name} run ${middayEarly}% early ${PERIOD_WORDS.midday} against ${peakEarly}% in the peaks. Midday is over-run.`,
        });
      }
    }
  }
  return out;
}

/** One route's readings, reduced to what the ranked route list shows. */
export interface RouteReadingSummary {
  /** Readings of every kind and period. */
  readings: number;
  /** Distinct segments with at least one reading: what "confirmed by Avail" counts. */
  confirmed_segments: number;
  /**
   * The reading the list names: the under-run whose peak most exceeds midday,
   * else the strongest midday over-run; null with no readings.
   */
  worst: ObservedReading | null;
}

export function summarizeRouteReadings(found: readonly ObservedReading[]): RouteReadingSummary {
  const segments = new Set(found.map((r) => `${r.from_stop_id}\u0000${r.to_stop_id}`));
  const gap = (r: ObservedReading) => r.peak_pct - r.off_peak_pct;
  const underRuns = found.filter((r) => r.kind === "peak_under_run").sort((a, b) => gap(b) - gap(a));
  const overRuns = found.filter((r) => r.kind === "off_peak_over_run").sort((a, b) => (b.off_peak_pct - b.peak_pct) - (a.off_peak_pct - a.peak_pct));
  return { readings: found.length, confirmed_segments: segments.size, worst: underRuns[0] ?? overRuns[0] ?? null };
}
