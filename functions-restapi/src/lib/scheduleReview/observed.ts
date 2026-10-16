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

/** A flat segment whose downstream timepoint shows the signature of a wrong running time. */
export interface ObservedReading {
  kind: ObservedReadingKind;
  from_stop_id: string;
  to_stop_id: string;
  from_stop_name: string;
  to_stop_name: string;
  scheduled_minutes: number;
  peak_pct: number;
  off_peak_pct: number;
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

/** Points by which the peak and off-peak shares must differ before a reading is made. */
export const READING_MIN_POINT_GAP = 15;
/** Departures each side needs before a share means anything. */
export const READING_MIN_DEPARTURES = 20;

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

function sides(rows: readonly ObservedRow[], stopId: string): { peak: Side; offPeak: Side } {
  const peak: Side = { departures: 0, early: 0, late: 0 };
  const offPeak: Side = { departures: 0, early: 0, late: 0 };
  for (const row of rows) {
    if (row.stop_id !== stopId || row.total <= 0) continue;
    const side = PEAK_HOURS.has(row.hour_of_day) ? peak : offPeak;
    side.departures += row.total;
    side.early += row.early;
    side.late += row.late;
  }
  return { peak, offPeak };
}

/**
 * One reading per flat segment whose downstream timepoint tells on it. Both
 * directions of a station are read together: the segment's direction is not
 * in the detail, and a station late both ways is late.
 */
export function readings(rows: readonly ObservedRow[], segments: readonly TimepointSegmentDetail[]): ObservedReading[] {
  const out: ObservedReading[] = [];
  for (const segment of segments) {
    if (!isFlatSegment(segment)) continue;
    const { peak, offPeak } = sides(rows, segment.to_stop_id);
    if (peak.departures < READING_MIN_DEPARTURES || offPeak.departures < READING_MIN_DEPARTURES) continue;
    const minutes = segment.hours[0].min_minutes;
    const peakLate = pct(peak.late, peak.departures);
    const offPeakLate = pct(offPeak.late, offPeak.departures);
    const peakEarly = pct(peak.early, peak.departures);
    const offPeakEarly = pct(offPeak.early, offPeak.departures);
    const base = { from_stop_id: segment.from_stop_id, to_stop_id: segment.to_stop_id, from_stop_name: segment.from_stop_name, to_stop_name: segment.to_stop_name, scheduled_minutes: minutes };
    if (peakLate - offPeakLate >= READING_MIN_POINT_GAP) {
      out.push({
        ...base,
        kind: "peak_under_run",
        peak_pct: peakLate,
        off_peak_pct: offPeakLate,
        text: `${segment.from_stop_name} → ${segment.to_stop_name}: scheduled ${minutes} min at every hour; the late share at ${segment.to_stop_name} rises from ${offPeakLate}% off-peak to ${peakLate}% in the peak. The peak is under-run.`,
      });
    } else if (offPeakEarly - peakEarly >= READING_MIN_POINT_GAP) {
      out.push({
        ...base,
        kind: "off_peak_over_run",
        peak_pct: peakEarly,
        off_peak_pct: offPeakEarly,
        text: `${segment.from_stop_name} → ${segment.to_stop_name}: scheduled ${minutes} min at every hour; the early share at ${segment.to_stop_name} is ${offPeakEarly}% off-peak against ${peakEarly}% in the peak. The off-peak is over-run.`,
      });
    }
  }
  return out;
}
