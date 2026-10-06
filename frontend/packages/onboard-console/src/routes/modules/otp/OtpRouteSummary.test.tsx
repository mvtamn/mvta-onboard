import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OtpMonthMeasurement, OtpRouteFigure, OtpRouteStops, OtpStopFigure } from "@mvta/shared";
import { RouteSummaryPage } from "./OtpRouteSummary.js";
import { displayRoutes } from "./otpFigures.js";

const figure = (departures: number, ontime: number) => ({ departures, ontime, pct: departures > 0 ? ontime / departures : null });

const route: OtpRouteFigure = {
  route_id: 460, route_label: "460", route_category: "FixedRoute",
  raw: figure(500, 400), excluded: figure(100, 40), assessable: figure(400, 360),
  stop_excluded: figure(100, 40), date_excluded: figure(0, 0), below_target: false,
};

const measurement: OtpMonthMeasurement = {
  service_month: "202609", target: 0.85, target_source: "catalog",
  raw: route.raw, excluded: route.excluded, stop_excluded: route.stop_excluded,
  date_excluded: route.date_excluded, assessable: route.assessable,
  routes: [route], routes_below_target: 0,
  weather_days_recorded: 0, weather_days_applied: 0, feed_ready: true,
};

const stop = (stop_id: number, stop_name: string, total: number, ontime: number, over: Partial<OtpStopFigure> = {}): OtpStopFigure => {
  const mix = { total, early: 0, ontime, late: total - ontime, other: 0 };
  return {
    stop_id, stop_name, raw: figure(total, ontime), raw_mix: mix, mix,
    assessable: figure(total, ontime), date_excluded: figure(0, 0), excluded_days: [], ...over,
  };
};

const stops: OtpRouteStops = {
  service_month: "202609", route_id: 460, target: 0.85, target_source: "catalog", route, feed_ready: true,
  stops: [
    stop(100, "Apple Valley TS", 200, 190),
    stop(101, "Burnsville TS", 100, 40, { assessable: figure(0, 0), mix: { total: 0, early: 0, ontime: 0, late: 0, other: 0 }, excluded_days: ["Mon"] }),
    stop(102, "Cedar Grove", 200, 170),
  ],
};

const getOtpRouteStops = vi.fn();
vi.mock("../../../config.js", () => ({ api: { getOtpRouteStops: (...args: unknown[]) => getOtpRouteStops(...args) } }));

describe("Route Summary's timepoint drill-down", () => {
  afterEach(() => {
    cleanup();
    getOtpRouteStops.mockReset();
  });

  it("opens a route's timepoints worst first, excluded ones last", async () => {
    getOtpRouteStops.mockResolvedValue(stops);
    render(<RouteSummaryPage displayRows={displayRoutes(measurement)} targetPct={85} measurement={measurement} serviceMonth="202609" />);

    await userEvent.click(screen.getByRole("button", { name: /RT 460/ }));
    const list = await screen.findByRole("list", { name: /Route 460 timepoints/ });
    const rows = within(list).getAllByRole("listitem").map((item) => item.getAttribute("aria-label"));
    expect(rows).toEqual([
      "Cedar Grove: 85% on time, 200 departures, 0% early, 15% late",
      "Apple Valley TS: 95% on time, 200 departures, 0% early, 5% late",
      "Burnsville TS: not assessed, 100 departures, 0% early, 60% late. Excluded: Mon",
    ]);
    expect(getOtpRouteStops).toHaveBeenCalledWith(460, "202609");
    expect(screen.getByText(/route 90% official/)).toBeInTheDocument();
  });

  it("closes from its own button and from the route again", async () => {
    getOtpRouteStops.mockResolvedValue(stops);
    render(<RouteSummaryPage displayRows={displayRoutes(measurement)} targetPct={85} measurement={measurement} serviceMonth="202609" />);

    const toggle = screen.getByRole("button", { name: /RT 460/ });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("list", { name: /Route 460 timepoints/ })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("says why a stop list could not load", async () => {
    getOtpRouteStops.mockRejectedValue(new Error("offline"));
    render(<RouteSummaryPage displayRows={displayRoutes(measurement)} targetPct={85} measurement={measurement} serviceMonth="202609" />);
    await userEvent.click(screen.getByRole("button", { name: /RT 460/ }));
    expect(await screen.findByText("Could not reach the OTP compliance service.")).toBeInTheDocument();
  });

  it("offers no drill-down on sample data, which has no timepoints behind it", () => {
    render(<RouteSummaryPage displayRows={displayRoutes(measurement)} targetPct={85} measurement={null} serviceMonth={null} />);
    expect(screen.queryByRole("button", { name: /RT 460/ })).not.toBeInTheDocument();
  });
});
