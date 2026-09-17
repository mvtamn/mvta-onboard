import { describe, expect, it } from "vitest";
import type { OtpMonthMeasurement, OtpRouteFigure } from "@mvta/shared";
import { displayRoute, displayRoutes, percentText, previewRoutes, targetSentence, weatherSentence } from "./otpFigures";

const figure = (departures: number, ontime: number) => ({ departures, ontime, pct: departures > 0 ? ontime / departures : null });

function route(overrides: Partial<OtpRouteFigure> = {}): OtpRouteFigure {
  return {
    route_id: 460, route_label: "460", route_category: "FixedRoute",
    raw: figure(300, 210), excluded: figure(100, 40), assessable: figure(200, 170),
    below_target: false, ...overrides,
  };
}

describe("displayRoute", () => {
  it("shows the official figure, the raw one, and how far the exclusions moved it", () => {
    expect(displayRoute(route())).toEqual({
      key: "460", label: "460", departures: 300,
      rawPct: 70, officialPct: 85, deltaPoints: 15, status: "meets", note: null,
    });
  });

  it("marks a route below the target the server judged it against", () => {
    expect(displayRoute(route({ below_target: true })).status).toBe("below");
  });

  it("says why a route is not measured rather than showing it as 0%", () => {
    const shuttle = displayRoute(route({
      route_id: 1131, route_label: "St Fair Shuttle", route_category: "SpecialEvent",
      raw: figure(50, 10), excluded: figure(50, 10), assessable: figure(0, 0), below_target: null,
    }));
    expect(shuttle.status).toBe("not_measured");
    expect(shuttle.officialPct).toBeNull();
    expect(shuttle.note).toMatch(/outside the fixed-route standard/);
    expect(displayRoute(route({ route_category: "NonRevenue", assessable: figure(0, 0), below_target: null })).note)
      .toMatch(/carries no passengers/);
    // A fixed route whose every departure was excluded is not "0% on time" either.
    expect(displayRoute(route({ assessable: figure(0, 0), below_target: null })).note)
      .toMatch(/Every departure on this route is excluded/);
  });

  it("maps a whole measurement", () => {
    const measurement = { routes: [route(), route({ route_id: 470, route_label: null, below_target: true })] } as OtpMonthMeasurement;
    expect(displayRoutes(measurement).map(r => [r.label, r.status])).toEqual([["460", "meets"], ["470", "below"]]);
  });
});

describe("the sample preview", () => {
  it("shows the raw figure and says it is sample data", () => {
    const [row] = previewRoutes([{ route: "493", total: 102, ontime: 45, pct_raw: 44.1 }], 85);
    expect(row).toMatchObject({ label: "493", rawPct: 44.1, officialPct: null, status: "below", note: "Sample data — no exclusions applied" });
  });
});

describe("sentences", () => {
  it("says where the target came from", () => {
    expect(targetSentence(90, "period_rule_set")).toBe("Target 90%, from this month's assessment rules.");
    expect(targetSentence(85, "catalog")).toBe("Target 85%, from the current performance standard.");
    expect(targetSentence(85, "default")).toMatch(/no performance standard is configured/);
  });

  it("says weather days are recorded and not applied, and why", () => {
    expect(weatherSentence(0)).toMatch(/No weather or emergency days/);
    expect(weatherSentence(1)).toMatch(/^1 day is recorded/);
    const sentence = weatherSentence(3);
    expect(sentence).toMatch(/3 days are recorded/);
    expect(sentence).toMatch(/NOT removed/);
    expect(sentence).toMatch(/day of week, not by date/);
  });

  it("never prints a percentage it does not have", () => {
    expect(percentText(null)).toBe("—");
    expect(percentText(85)).toBe("85%");
  });
});
