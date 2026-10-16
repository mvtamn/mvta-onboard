import { describe, expect, it } from "vitest";
import type { ObservedTimepoint, TimepointSegmentDetail } from "@mvta/shared";
import { buildGrid, gridDirections, observedMark, runningOrder } from "./directionGridModel.js";

function seg(from: string, to: string, direction: string | null, minutes: Record<number, number>, flat = false): TimepointSegmentDetail {
  return {
    from_stop_id: from, from_stop_name: `Stop ${from}`, to_stop_id: to, to_stop_name: `Stop ${to}`, miles: 3, direction, flat_all_day: flat,
    hours: Object.entries(minutes).map(([h, m]) => ({ hour: Number(h), trips: 2, min_minutes: m, max_minutes: m })),
  };
}

const W1 = seg("A", "B", "W", { 7: 10, 16: 10 }, true);
const W2 = seg("B", "C", "W", { 7: 20, 16: 20 }, true);
const E1 = seg("C", "B", "E", { 7: 18, 16: 22 });

const TPS: ObservedTimepoint[] = [
  { stop_id: "A", stop_name: "Stop A", direction: "W", departures: 40, in_schedule: true, hours: [{ hour: 16, departures: 20, early_pct: 0, ontime_pct: 80, late_pct: 20 }] },
  { stop_id: "B", stop_name: "Stop B", direction: "W", departures: 40, in_schedule: true, hours: [{ hour: 16, departures: 20, early_pct: 0, ontime_pct: 54, late_pct: 46 }, { hour: 12, departures: 20, early_pct: 0, ontime_pct: 100, late_pct: 0 }] },
  { stop_id: "B", stop_name: "Stop B", direction: "E", departures: 40, in_schedule: true, hours: [{ hour: 16, departures: 20, early_pct: 30, ontime_pct: 70, late_pct: 0 }] },
];

describe("direction grid", () => {
  it("lists the directions the segments run", () => {
    expect(gridDirections([W1, E1, W2])).toEqual(["W", "E"]);
    expect(gridDirections([seg("A", "B", null, { 7: 5 })])).toEqual([null]);
  });

  it("orders segments along the route, wherever the review listed them", () => {
    expect(runningOrder([W2, W1]).map((s) => s.from_stop_id)).toEqual(["A", "B"]);
  });

  it("puts schedule and street in one row per segment, matched by direction and hour", () => {
    const { hours, rows } = buildGrid([W2, E1, W1], "W", TPS, []);
    expect(hours).toEqual([7, 12, 16]);
    expect(rows.map((r) => [r.from, r.to, r.flat, r.measured])).toEqual([
      ["Stop A", null, false, true],
      ["Stop A", "Stop B", true, true],
      ["Stop B", "Stop C", true, false],
    ]);
    const ab = rows[1].cells;
    expect(ab.map((c) => [c.scheduled, c.observed?.text ?? null])).toEqual([["10", null], [null, "ok"], ["10", "46L"]]);
    expect(ab[2].observed?.level).toBe(2);
    expect(ab[2].label).toBe("4p: 10 min scheduled, 46% late, 20 departures");
    // Eastbound departures from B are not westbound evidence.
    expect(ab.some((c) => c.observed?.kind === "early")).toBe(false);
  });

  it("marks early departures in their own kind, never at the strongest level", () => {
    expect(observedMark({ hour: 7, departures: 20, early_pct: 85, ontime_pct: 15, late_pct: 0 })).toMatchObject({ kind: "early", level: 1, text: "85E" });
    expect(observedMark({ hour: 7, departures: 20, early_pct: 0, ontime_pct: 75, late_pct: 25 })).toMatchObject({ kind: "late", level: 2 });
    expect(observedMark({ hour: 7, departures: 20, early_pct: 0, ontime_pct: 100, late_pct: 0 })).toMatchObject({ kind: "ok", text: "ok" });
  });

  it("attaches a reading to its segment and direction", () => {
    const reading = { kind: "peak_under_run", period: "pm", direction: "W", from_stop_id: "A", to_stop_id: "B", from_stop_name: "Stop A", to_stop_name: "Stop B", scheduled_minutes: 10, peak_pct: 46, off_peak_pct: 0, upstream_pct: 20, text: "x" } as const;
    const { rows } = buildGrid([W1, W2], "W", TPS, [reading]);
    expect(rows.map((r) => r.readings.length)).toEqual([0, 1, 0]);
  });
});
