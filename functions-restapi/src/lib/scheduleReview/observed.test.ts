import { test } from "node:test";
import assert from "node:assert";
import { isFlatSegment, readings, summarizeObserved, type ObservedRow } from "./observed";
import type { TimepointSegmentDetail } from "./types";

const WINDOW = { days: 28, dow: "weekday" as const, first_day: "20260916", last_day: "20261014", service_days: 20 };

function segment(from: string, to: string, minutesByHour: Record<number, number>): TimepointSegmentDetail {
  return {
    from_stop_id: from, from_stop_name: `Stop ${from}`, to_stop_id: to, to_stop_name: `Stop ${to}`, miles: 3,
    hours: Object.entries(minutesByHour).map(([hour, minutes]) => ({ hour: Number(hour), trips: 2, min_minutes: minutes, max_minutes: minutes })),
  };
}

const FLAT = segment("A", "B", { 6: 10, 7: 10, 10: 10, 12: 10, 16: 10 });
const VARIED = segment("B", "C", { 6: 12, 7: 14, 10: 12, 16: 15 });

function row(stop_id: string, hour_of_day: number, early: number, ontime: number, late: number, direction: string | null = null): ObservedRow {
  return { stop_id, stop_name: `Avail ${stop_id}`, direction, hour_of_day, early, ontime, late, total: early + ontime + late };
}

test("each timepoint's hours carry Avail's split as percentages, in the schedule's order, with unscheduled stops last", () => {
  const rows = [row("Z", 7, 1, 9, 0), row("B", 16, 2, 4, 4), row("B", 7, 0, 10, 0), row("A", 7, 1, 8, 1)];
  const observed = summarizeObserved(rows, [FLAT, VARIED], WINDOW);
  assert.deepStrictEqual(observed.timepoints.map((tp) => [tp.stop_id, tp.stop_name, tp.in_schedule, tp.departures]), [
    ["A", "Stop A", true, 10],
    ["B", "Stop B", true, 20],
    ["Z", "Avail Z", false, 10],
  ]);
  assert.deepStrictEqual(observed.timepoints[1].hours, [
    { hour: 7, departures: 10, early_pct: 0, ontime_pct: 100, late_pct: 0 },
    { hour: 16, departures: 10, early_pct: 20, ontime_pct: 40, late_pct: 40 },
  ]);
  assert.strictEqual(observed.departures, 40);
  assert.deepStrictEqual(observed.window, WINDOW);
});

test("a station Avail reports in two directions is two rows, not an average", () => {
  const rows = [row("B", 7, 0, 10, 0, "North"), row("B", 7, 5, 5, 0, "South")];
  const observed = summarizeObserved(rows, [FLAT], WINDOW);
  assert.deepStrictEqual(observed.timepoints.map((tp) => [tp.direction, tp.hours[0].early_pct]), [["North", 0], ["South", 50]]);
});

test("rows with no departures are left out rather than shown as 0%", () => {
  const observed = summarizeObserved([row("B", 3, 0, 0, 0)], [FLAT], WINDOW);
  assert.deepStrictEqual(observed.timepoints, []);
});

test("a flat segment whose downstream timepoint runs late in the peak reads as under-run", () => {
  const rows = [
    row("B", 7, 0, 12, 8), row("B", 16, 0, 10, 10),   // peak: 18 late of 40 = 45%
    row("B", 10, 1, 19, 0), row("B", 12, 0, 18, 2),   // off-peak: 2 late of 40 = 5%
  ];
  const found = readings(rows, [FLAT, VARIED]);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, "peak_under_run");
  assert.strictEqual(found[0].to_stop_id, "B");
  assert.strictEqual(found[0].peak_pct, 45);
  assert.strictEqual(found[0].off_peak_pct, 5);
  assert.strictEqual(found[0].text, "Stop A → Stop B: scheduled 10 min at every hour; the late share at Stop B rises from 5% off-peak to 45% in the peak. The peak is under-run.");
});

test("a flat segment whose downstream timepoint runs early off-peak reads as over-run", () => {
  const rows = [
    row("B", 7, 1, 19, 0), row("B", 16, 2, 18, 0),    // peak early 3 of 40 = 8%
    row("B", 10, 8, 12, 0), row("B", 12, 9, 11, 0),   // off-peak early 17 of 40 = 43%
  ];
  const found = readings(rows, [FLAT]);
  assert.strictEqual(found[0].kind, "off_peak_over_run");
  assert.match(found[0].text, /early share at Stop B is 43% off-peak against 8% in the peak\. The off-peak is over-run\.$/);
});

test("no reading without enough departures on both sides, or when the shares barely differ", () => {
  const thin = [row("B", 7, 0, 5, 5), row("B", 12, 0, 10, 0)];
  assert.deepStrictEqual(readings(thin, [FLAT]), []);
  const close = [row("B", 7, 0, 30, 10), row("B", 12, 0, 32, 8)];
  assert.deepStrictEqual(readings(close, [FLAT]), []);
});

test("a segment that already varies by hour is not read, whatever Avail saw", () => {
  const rows = [row("C", 7, 0, 10, 30), row("C", 12, 0, 40, 0)];
  assert.deepStrictEqual(readings(rows, [VARIED]), []);
});

test("flatness needs three start hours across the peak and the off-peak", () => {
  assert.strictEqual(isFlatSegment(FLAT), true);
  assert.strictEqual(isFlatSegment(VARIED), false);
  assert.strictEqual(isFlatSegment(segment("A", "B", { 6: 10, 7: 10, 8: 10 })), false);
  assert.strictEqual(isFlatSegment(segment("A", "B", { 6: 10, 12: 10 })), false);
});
