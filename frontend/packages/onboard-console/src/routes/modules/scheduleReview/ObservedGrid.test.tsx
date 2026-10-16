import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ApiError, type MyAccess, type ObservedOtpResponse } from "@mvta/shared";
import { StaticAccessProvider } from "../../../auth/AccessContext.js";
import { ObservedGrid, cellLevel, cellReading } from "./ObservedGrid.js";

const { getGtfsPredictionRiskRouteObserved } = vi.hoisted(() => ({ getGtfsPredictionRiskRouteObserved: vi.fn() }));
vi.mock("../../../config.js", () => ({ api: { getGtfsPredictionRiskRouteObserved } }));

function access(actions: string[]): MyAccess {
  return {
    person: { objectId: null, tenantId: null, name: "Test", email: null },
    roles: [], actions, summary: [], ingestion: false, rolesInOnBoard: true,
  };
}

function withAccess(actions: string[], node: ReactNode) {
  return <StaticAccessProvider access={access(actions)}>{node}</StaticAccessProvider>;
}

const OBSERVED: ObservedOtpResponse = {
  window: { days: 28, dow: "weekday", first_day: "20260917", last_day: "20261014", service_days: 20 },
  departures: 640,
  schedule_available: true,
  timepoints: [
    { stop_id: "B", stop_name: "157th Street Station", direction: null, departures: 320, in_schedule: true, hours: [
      { hour: 7, departures: 40, early_pct: 0, ontime_pct: 100, late_pct: 0 },
      { hour: 16, departures: 40, early_pct: 5, ontime_pct: 57, late_pct: 38 },
    ] },
    { stop_id: "C", stop_name: "Apple Valley TS", direction: "North", departures: 300, in_schedule: true, hours: [
      { hour: 10, departures: 40, early_pct: 12, ontime_pct: 85, late_pct: 3 },
    ] },
    { stop_id: "Z", stop_name: "Cedar Grove", direction: null, departures: 20, in_schedule: false, hours: [
      { hour: 10, departures: 20, early_pct: 0, ontime_pct: 95, late_pct: 5 },
    ] },
  ],
  readings: [
    {
      kind: "peak_under_run", from_stop_id: "A", to_stop_id: "B", from_stop_name: "Rosemount TS", to_stop_name: "157th Street Station",
      scheduled_minutes: 20, peak_pct: 36, off_peak_pct: 9,
      text: "Rosemount TS → 157th Street Station: scheduled 20 min at every hour; the late share at 157th Street Station rises from 9% off-peak to 36% in the peak. The peak is under-run.",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ObservedGrid", () => {
  it("says it needs Compliance access instead of asking the API, for someone without it", () => {
    render(withAccess(["schedule-review.view"], <ObservedGrid routeId="420" routeLabel="420" hours={[7, 16]} />));
    expect(screen.getByText(/needs Compliance access, because it reads OTP data/)).toBeInTheDocument();
    expect(getGtfsPredictionRiskRouteObserved).not.toHaveBeenCalled();
  });

  it("asks for nothing outside an access provider", () => {
    render(<ObservedGrid routeId="420" routeLabel="420" hours={[7]} />);
    expect(getGtfsPredictionRiskRouteObserved).not.toHaveBeenCalled();
  });

  it("shows the readings, the window, and each timepoint's larger share per hour on the schedule grid's columns", async () => {
    getGtfsPredictionRiskRouteObserved.mockResolvedValue(OBSERVED);
    render(withAccess(["compliance-review.view"], <ObservedGrid routeId="420" routeLabel="420" hours={[6, 7, 16]} />));

    const readings = await screen.findByRole("list", { name: "Route 420: where the schedule and Avail disagree" });
    expect(within(readings).getByText("Peak under-run")).toBeInTheDocument();
    expect(within(readings).getByText(/rises from 9% off-peak to 36% in the peak/)).toBeInTheDocument();
    expect(screen.getByText(/20 weekdays with data, Sep 17, 2026 – Oct 14, 2026 · 640 departures/)).toBeInTheDocument();

    const grid = screen.getByRole("table", { name: "Route 420 Avail early and late shares per timepoint by departure hour" });
    expect(within(grid).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Timepoint", "Dep.", "6a", "7a", "10a", "4p"]);
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByRole("cell").map((td) => td.textContent)).toEqual(["320", "·", "✓", "·", "38L"]);
    expect(within(rows[0]).getByLabelText("4p: 38% late, 40 departures")).toHaveClass("late", "l2");
    expect(within(rows[1]).getByText("North")).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText("10a: 12% early, 40 departures")).toHaveClass("early", "l1");
    expect(within(rows[2]).getByText("not a timepoint")).toBeInTheDocument();
    expect(getGtfsPredictionRiskRouteObserved).toHaveBeenCalledWith("420", { days: 28, dow: "weekday" });
  });

  it("asks again for the window and service days the reader picks", async () => {
    getGtfsPredictionRiskRouteObserved.mockResolvedValue(OBSERVED);
    render(withAccess(["compliance-review.view"], <ObservedGrid routeId="420" routeLabel="420" hours={[7]} />));
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "90 days" }));
    expect(getGtfsPredictionRiskRouteObserved).toHaveBeenLastCalledWith("420", { days: 90, dow: "weekday" });
    await userEvent.click(screen.getByRole("button", { name: "Saturdays" }));
    expect(getGtfsPredictionRiskRouteObserved).toHaveBeenLastCalledWith("420", { days: 90, dow: "saturday" });
    expect(screen.getByRole("button", { name: "Saturdays" })).toHaveAttribute("aria-pressed", "true");
    getGtfsPredictionRiskRouteObserved.mockResolvedValue({ ...OBSERVED, window: { ...OBSERVED.window, dow: "saturday", service_days: 4 } });
    await userEvent.click(screen.getByRole("button", { name: "Sundays" }));
    await userEvent.click(screen.getByRole("button", { name: "Saturdays" }));
    expect(await screen.findByText(/^4 Saturdays with data/)).toBeInTheDocument();
  });

  it("says so when there is no reading, and when the schedule's evidence is not kept", async () => {
    getGtfsPredictionRiskRouteObserved.mockResolvedValueOnce({ ...OBSERVED, readings: [] });
    const { unmount } = render(withAccess(["compliance-review.view"], <ObservedGrid routeId="420" routeLabel="420" hours={[7]} />));
    expect(await screen.findByText(/No segment scheduled the same all day shows a peak or off-peak difference/)).toBeInTheDocument();
    unmount();

    getGtfsPredictionRiskRouteObserved.mockResolvedValueOnce({ ...OBSERVED, readings: [], schedule_available: false });
    render(withAccess(["compliance-review.view"], <ObservedGrid routeId="420" routeLabel="420" hours={[7]} />));
    expect(await screen.findByText(/not kept yet \(migration 145\)/)).toBeInTheDocument();
  });

  it("passes on the server's words when Avail has nothing for the route", async () => {
    getGtfsPredictionRiskRouteObserved.mockRejectedValue(new ApiError(404, "Avail's OTP daily feed has no rows for this route in the last 28 weekdays."));
    render(withAccess(["compliance-review.view"], <ObservedGrid routeId="999" routeLabel="999" hours={[7]} />));
    expect(await screen.findByText("Avail's OTP daily feed has no rows for this route in the last 28 weekdays.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("ObservedGrid readings", () => {
  it("shows three readings and the rest on request", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...OBSERVED.readings[0], from_stop_id: `F${i}`, text: `Reading ${i + 1}` }));
    getGtfsPredictionRiskRouteObserved.mockResolvedValue({ ...OBSERVED, readings: many });
    render(withAccess(["compliance-review.view"], <ObservedGrid routeId="420" routeLabel="420" hours={[7]} />));

    const list = await screen.findByRole("list", { name: "Route 420: where the schedule and Avail disagree" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Show all 5 readings" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  });
});

describe("cell reading", () => {
  it("reads the larger of late and early, and on time when neither happened", () => {
    expect(cellReading({ hour: 7, departures: 10, early_pct: 10, ontime_pct: 70, late_pct: 20 })).toEqual({ kind: "late", pct: 20 });
    expect(cellReading({ hour: 7, departures: 10, early_pct: 30, ontime_pct: 60, late_pct: 10 })).toEqual({ kind: "early", pct: 30 });
    expect(cellReading({ hour: 7, departures: 10, early_pct: 0, ontime_pct: 100, late_pct: 0 })).toEqual({ kind: "ontime", pct: 100 });
  });

  it("steps the strength at 10 and 25 points", () => {
    expect([9, 10, 24, 25].map(cellLevel)).toEqual([0, 1, 1, 2]);
  });
});
