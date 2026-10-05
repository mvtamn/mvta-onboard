import { describe, expect, it } from "vitest";
import type { OtpStopFigure } from "@mvta/shared";
import { LOW_VOLUME_DEPARTURES, stopBar, stopBarLabel, stopBars } from "./otpStops";

const figure = (departures: number, ontime: number) => ({ departures, ontime, pct: departures > 0 ? ontime / departures : null });
const mix = (total: number, early: number, ontime: number, late: number) => ({ total, early, ontime, late, other: total - early - ontime - late });

function stop(id: number, total: number, ontime: number, overrides: Partial<OtpStopFigure> = {}): OtpStopFigure {
  const m = mix(total, Math.round((total - ontime) / 4), ontime, total - ontime - Math.round((total - ontime) / 4));
  return {
    stop_id: id, stop_name: `Stop ${id} name`,
    raw: figure(total, ontime), raw_mix: m, mix: m,
    assessable: figure(total, ontime), date_excluded: figure(0, 0), excluded_days: [],
    ...overrides,
  };
}

describe("stopBars", () => {
  it("puts the worst stop first, then thin stops, then excluded ones", () => {
    const bars = stopBars([
      stop(1, 200, 190),
      stop(2, 200, 120),
      stop(3, LOW_VOLUME_DEPARTURES - 1, 5),
      stop(4, 100, 20, { assessable: figure(0, 0), mix: mix(0, 0, 0, 0), excluded_days: ["Mon"] }),
      stop(5, 300, 240),
    ], 0.85);
    expect(bars.map((bar) => [bar.stopId, bar.kind])).toEqual([
      [2, "measured"], [5, "measured"], [1, "measured"], [3, "low_volume"], [4, "excluded"],
    ]);
    expect(bars.map((bar) => bar.belowTarget)).toEqual([true, true, false, true, null]);
  });

  it("breaks a tie toward the stop with more departures", () => {
    expect(stopBars([stop(1, 100, 80), stop(2, 400, 320)], 0.85).map((bar) => bar.stopId)).toEqual([2, 1]);
  });
});

describe("stopBar", () => {
  it("draws the counted split, on-time first, and sums to the whole bar", () => {
    const bar = stopBar(stop(1, 200, 150, { mix: mix(200, 10, 150, 30) }), 0.85, true);
    expect(bar.officialPct).toBe(75);
    expect(bar.segments).toEqual({ ontime: 0.75, early: 0.05, late: 0.15, other: 0.05 });
    expect(bar.approximate).toBe(false);
    expect(bar.note).toBeNull();
  });

  it("keeps on-time equal to the official figure after a weather day and apportions the rest", () => {
    // 200 before the date, 30 of them (12 on time) taken by an approved snow day.
    const bar = stopBar(stop(1, 200, 170, {
      mix: mix(200, 10, 170, 20),
      assessable: figure(170, 158),
      date_excluded: figure(30, 12),
    }), 0.85, true);
    expect(bar.officialPct).toBe(92.9);
    expect(bar.segments.ontime).toBeCloseTo(158 / 170);
    expect(bar.segments.early / bar.segments.late).toBeCloseTo(10 / 20);
    expect(bar.segments.ontime + bar.segments.early + bar.segments.late + bar.segments.other).toBeCloseTo(1);
    expect(bar.approximate).toBe(true);
    expect(bar.note).toBe("Weather days removed 30");
  });

  it("shows an excluded stop's raw split and says which days came out", () => {
    const bar = stopBar(stop(1, 100, 40, {
      raw_mix: mix(100, 0, 40, 50), mix: mix(0, 0, 0, 0), assessable: figure(0, 0), excluded_days: ["Mon", "Tues"],
    }), 0.85, true);
    expect(bar).toMatchObject({ kind: "excluded", officialPct: null, departures: 100, belowTarget: null, note: "Excluded: Mon, Tues" });
    expect(bar.segments.ontime).toBeCloseTo(0.4);
  });

  it("says a non-fixed-route stop is outside the standard rather than excluded by a reviewer", () => {
    const bar = stopBar(stop(1, 50, 10, { mix: mix(0, 0, 0, 0), assessable: figure(0, 0) }), 0.85, false);
    expect(bar.note).toBe("Route is outside the fixed-route standard");
  });

  it("names a partly excluded stop's days and still measures the rest", () => {
    const bar = stopBar(stop(1, 100, 90, { excluded_days: ["Sat"] }), 0.85, true);
    expect([bar.kind, bar.note]).toEqual(["measured", "Sat excluded"]);
  });

  it("falls back to the stop ID when Avail sent no name", () => {
    expect(stopBar(stop(3242, 100, 90, { stop_name: null }), 0.85, true).name).toBe("Stop 3242");
  });
});

describe("stopBarLabel", () => {
  it("reads the figure, the volume and the lean", () => {
    const bar = stopBar(stop(1, 200, 150, { mix: mix(200, 10, 150, 30) }), 0.85, true);
    expect(stopBarLabel(bar)).toBe("Stop 1 name: 75% on time, 200 departures, 5% early, 15% late");
  });
});
