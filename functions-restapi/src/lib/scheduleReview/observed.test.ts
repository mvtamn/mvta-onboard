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

/** n departures in an hour, `late` of them late and `early` early. */
function hour(stop_id: string, hour_of_day: number, n: number, late: number, early = 0, direction: string | null = null): ObservedRow {
  return { stop_id, stop_name: `Avail ${stop_id}`, direction, hour_of_day, early, late, ontime: n - late - early, total: n };
}

/** A whole weekday at one stop: `pm` late of 20 in each PM hour, `mid` late of 20 in each midday hour. */
function day(stop_id: string, direction: string | null, { am = 0, pm = 0, mid = 0, evening = 0, midEarly = 0 } = {}): ObservedRow[] {
  return [
    ...[6, 7, 8].map((h) => hour(stop_id, h, 20, am, 0, direction)),
    ...[10, 11, 12, 13, 14].map((h) => hour(stop_id, h, 20, mid, midEarly, direction)),
    ...[15, 16, 17, 18].map((h) => hour(stop_id, h, 20, pm, 0, direction)),
    hour(stop_id, 19, 20, evening, 0, direction),
  ];
}

const FLAT_W = { ...FLAT, direction: "W" };

test("a flat segment whose next timepoint runs late in the PM peak, and later than the one before it, is a PM under-run", () => {
  const rows = [...day("A", "W", { pm: 4, mid: 0 }), ...day("B", "W", { pm: 10, mid: 1 })];
  const found = readings(rows, [FLAT_W]);
  assert.strictEqual(found.length, 1);
  assert.deepStrictEqual(
    [found[0].kind, found[0].period, found[0].direction, found[0].peak_pct, found[0].off_peak_pct, found[0].upstream_pct],
    ["peak_under_run", "pm", "W", 50, 5, 20],
  );
  assert.strictEqual(found[0].text, "Stop A → Stop B (westbound): scheduled 10 min at every hour; departures from Stop B run 50% late 3–7pm against 5% midday, up from 20% at Stop A. The PM peak is under-run.");
});

test("each direction is read on its own: an on-time opposite direction does not hide a late one", () => {
  // Pooled, B would be 25% late in the PM peak; westbound alone it is 50%.
  const rows = [...day("A", "W"), ...day("B", "W", { pm: 10 }), ...day("B", "E")];
  assert.deepStrictEqual(readings(rows, [FLAT_W]).map((r) => [r.direction, r.peak_pct]), [["W", 50]]);
  // And the eastbound segment into B reads nothing, because eastbound B is on time.
  assert.deepStrictEqual(readings(rows, [{ ...FLAT, direction: "E" }]), []);
});

test("Avail's direction is matched on its first letter", () => {
  const rows = [...day("A", "Westbound"), ...day("B", "Westbound", { pm: 10 })];
  assert.strictEqual(readings(rows, [FLAT_W]).length, 1);
});

test("the evening is not counted as off-peak: lateness carried past 7pm does not dilute midday", () => {
  // 420 westbound at 157th Street: 46% late 3-7pm, 50% at 7pm, 4% midday.
  const rows = [...day("A", "W"), ...day("B", "W", { pm: 9, mid: 1, evening: 10 })];
  const [found] = readings(rows, [FLAT_W]);
  assert.deepStrictEqual([found.peak_pct, found.off_peak_pct], [45, 5]);
});

test("lateness the bus brings in from upstream is not blamed on the segment", () => {
  const rows = [...day("A", "W", { pm: 9 }), ...day("B", "W", { pm: 10 })];
  assert.deepStrictEqual(readings(rows, [FLAT_W]), []);
});

test("when the timepoint before is not measured the reading is kept and says so", () => {
  const [found] = readings(day("B", "W", { pm: 10 }), [FLAT_W]);
  assert.strictEqual(found.upstream_pct, null);
  assert.match(found.text, /and the timepoint before it is not measured, so some of that may come from earlier in the trip\. The PM peak looks under-run\.$/);
});

test("the AM and PM peaks are read separately", () => {
  const rows = [...day("A", "W"), ...day("B", "W", { am: 8, pm: 0 })];
  assert.deepStrictEqual(readings(rows, [FLAT_W]).map((r) => [r.period, r.peak_pct]), [["am", 40]]);
});

test("a flat segment whose next timepoint runs early at midday reads as a midday over-run", () => {
  const rows = [...day("A", "W"), ...day("B", "W", { midEarly: 6 })];
  const found = readings(rows, [FLAT_W]);
  assert.deepStrictEqual(found.map((r) => [r.kind, r.period, r.peak_pct, r.off_peak_pct]), [["off_peak_over_run", "midday", 0, 30]]);
  assert.match(found[0].text, /run 30% early 10am–3pm against 0% in the peaks\. Midday is over-run\.$/);
});

test("a segment stored without a direction is read across both directions, and says no direction", () => {
  const rows = [...day("A", "W"), ...day("B", "W", { pm: 10 }), ...day("B", "E", { pm: 10 })];
  const [found] = readings(rows, [FLAT]);
  assert.strictEqual(found.direction, null);
  assert.match(found.text, /^Stop A → Stop B: scheduled/);
});

test("no reading without enough departures, or when the peak barely differs from midday", () => {
  assert.deepStrictEqual(readings([hour("B", 16, 10, 5), hour("B", 12, 10, 0)], [FLAT_W]), []);
  assert.deepStrictEqual(readings([...day("A", "W"), ...day("B", "W", { pm: 4, mid: 2 })], [FLAT_W]), []);
});

test("a segment that already varies by hour is not read, whatever Avail saw", () => {
  const rows = [...day("B", null), ...day("C", null, { pm: 15 })];
  assert.deepStrictEqual(readings(rows, [VARIED]), []);
});

test("flatness needs three start hours across the peak and the off-peak", () => {
  assert.strictEqual(isFlatSegment(FLAT), true);
  assert.strictEqual(isFlatSegment(VARIED), false);
  assert.strictEqual(isFlatSegment(segment("A", "B", { 6: 10, 7: 10, 8: 10 })), false);
  assert.strictEqual(isFlatSegment(segment("A", "B", { 6: 10, 12: 10 })), false);
});
