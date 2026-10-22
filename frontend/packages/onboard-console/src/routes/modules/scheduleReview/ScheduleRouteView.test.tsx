import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { ApiError, type MyAccess, type ObservedOtpResponse, type RouteScheduleDetailResponse } from "@mvta/shared";
import { StaticAccessProvider } from "../../../auth/AccessContext.js";
import { ScheduleRouteView, evidenceText } from "./ScheduleRouteView.js";

const { getGtfsPredictionRiskRoute, getGtfsPredictionRiskRouteObserved } = vi.hoisted(() => ({
  getGtfsPredictionRiskRoute: vi.fn(),
  getGtfsPredictionRiskRouteObserved: vi.fn(),
}));
vi.mock("../../../config.js", () => ({ api: { getGtfsPredictionRiskRoute, getGtfsPredictionRiskRouteObserved } }));

function access(actions: string[]): MyAccess {
  return { person: { objectId: null, tenantId: null, name: "Test", email: null }, roles: [], actions, summary: [], ingestion: false, rolesInOnBoard: true };
}

function view(node: ReactNode, actions = ["compliance-review.view"]) {
  return render(<MemoryRouter><StaticAccessProvider access={access(actions)}>{node}</StaticAccessProvider></MemoryRouter>);
}

const hours = (m: number, from = 5, to = 18) => Array.from({ length: to - from + 1 }, (_, i) => ({ hour: from + i, trips: 3, min_minutes: m, max_minutes: m }));

const DETAIL: RouteScheduleDetailResponse = {
  reviewed_at: "2026-10-16T09:00:00Z",
  confirmed_at: "2026-10-16T10:00:00Z",
  feed: { version: "20260909", start_date: "20260909", end_date: "20261101" },
  route_long_name: "Apple Valley-Rosemount-DCTC",
  checks: [
    { id: "placeholder_times", label: "Placeholder stop times", unit: "%", threshold: 10, comparison: "at_least", why: "One second apart.", owner: "avail", fix: "Export interpolated times." },
    { id: "run_time_flat", label: "Same running time all day", unit: "%", threshold: 50, comparison: "at_least", why: "Traffic never changes.", owner: "scheduling", fix: "Give the pattern peak running times." },
    { id: "interlined", label: "Continues from another route", unit: "%", threshold: 50, comparison: "at_least", why: "Off another route.", owner: "operations", fix: "Keep it knowingly." },
    { id: "timepoint_gap", label: "Longest gap between timepoints", unit: "min", threshold: 30, comparison: "at_least", why: "Traffic decides.", owner: "structural", fix: "Predict from GPS." },
  ],
  route: {
    route_id: "420", route_short_name: "420", trip_count: 90, stop_count: 69, timepoint_count: 4, pattern_count: 2, flag_count: 3,
    checks: [
      { id: "placeholder_times", value: 27, flagged: true, evidence: Array.from({ length: 8 }, (_, i) => ({ text: `Pair ${i + 1}: ${48 - i} trips`, count: 48 - i, value: null, stop_ids: [], trip_ids: [] })) },
      { id: "run_time_flat", value: 100, flagged: true, evidence: [{ text: "Every trip 40 min", count: 48, value: 40, stop_ids: [], trip_ids: [] }] },
      { id: "interlined", value: 46, flagged: false, evidence: [] },
      { id: "timepoint_gap", value: 45, flagged: true, evidence: [] },
    ],
    segments: [
      { from_stop_id: "R", from_stop_name: "Rosemount TS", to_stop_id: "S", to_stop_name: "157th Street Station", miles: 6.5, direction: "W", flat_all_day: true, hours: hours(20) },
      { from_stop_id: "D", from_stop_name: "DCTC", to_stop_id: "R", to_stop_name: "Rosemount TS", miles: 2.7, direction: "W", flat_all_day: true, hours: hours(7) },
      { from_stop_id: "S", from_stop_name: "157th Street Station", to_stop_id: "R", to_stop_name: "Rosemount TS", miles: 6.9, direction: "E", flat_all_day: true, hours: hours(20, 5, 20) },
    ],
  },
};

const READING = {
  kind: "peak_under_run", period: "pm", direction: "W", from_stop_id: "R", to_stop_id: "S", from_stop_name: "Rosemount TS", to_stop_name: "157th Street Station",
  scheduled_minutes: 20, peak_pct: 46, off_peak_pct: 4, upstream_pct: 20,
  text: "Rosemount TS → 157th Street Station (westbound): scheduled 20 min at every hour; departures from 157th Street Station run 46% late 3–7pm against 4% midday, up from 20% at Rosemount TS. The PM peak is under-run.",
} as const;

const OBSERVED: ObservedOtpResponse = {
  window: { days: 28, dow: "weekday", first_day: "20260918", last_day: "20261015", service_days: 20 },
  departures: 1772,
  schedule_available: true,
  timepoints: [
    { stop_id: "S", stop_name: "157th Street Station", direction: "W", departures: 279, in_schedule: true, hours: [{ hour: 17, departures: 20, early_pct: 0, ontime_pct: 42, late_pct: 58 }] },
    { stop_id: "R", stop_name: "Rosemount TS", direction: "W", departures: 278, in_schedule: true, hours: [{ hour: 17, departures: 20, early_pct: 0, ontime_pct: 70, late_pct: 30 }] },
  ],
  readings: [{ ...READING }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScheduleRouteView", () => {
  it("opens on the route's name and what Avail confirms", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    getGtfsPredictionRiskRouteObserved.mockResolvedValue(OBSERVED);
    view(<ScheduleRouteView routeId="420" routeLabel="420" />);

    expect(await screen.findByRole("heading", { level: 2, name: /420\s*Apple Valley-Rosemount-DCTC/ })).toBeInTheDocument();
    const confirms = await screen.findByRole("list", { name: "Route 420: where Avail confirms a schedule problem" });
    expect(within(confirms).getByText("PM peak under-run · westbound")).toBeInTheDocument();
    expect(within(confirms).getByText("Rosemount TS to 157th Street Station")).toBeInTheDocument();
    // Two fixable flags: the structural timepoint gap is not counted.
    expect(screen.getByText("2 fixable flags")).toBeInTheDocument();
    expect(screen.getByText("1 confirmed by Avail")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Link to this route" })).toHaveAttribute("href", "/?route=420");
  });

  it("puts schedule and street in one grid per direction, in running order, with the marker and the reading", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    getGtfsPredictionRiskRouteObserved.mockResolvedValue(OBSERVED);
    view(<ScheduleRouteView routeId="420" routeLabel="420" />);

    const grid = await screen.findByRole("table", { name: /Westbound, DCTC to 157th Street Station/ });
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "Leaves DCTCDepartures from the first timepoint",
      "Same all dayDCTCto Rosemount TS2.7 mi",
      "Same all dayRosemount TSto 157th Street Station6.5 miPM peak under-run: 46% late against 4% midday, up from 20%",
    ]);
    expect(within(rows[2]).getByLabelText("5p: 20 min scheduled, 58% late, 20 departures")).toHaveClass("late", "l2");

    await userEvent.click(screen.getByRole("button", { name: "Eastbound" }));
    expect(await screen.findByRole("table", { name: /Eastbound, 157th Street Station to Rosemount TS/ })).toBeInTheDocument();
  });

  it("groups checks by who can fix them, flagged first, and opens the structural ones closed", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    getGtfsPredictionRiskRouteObserved.mockResolvedValue(OBSERVED);
    view(<ScheduleRouteView routeId="420" routeLabel="420" />);

    expect(await screen.findByRole("heading", { level: 4, name: "MVTA scheduling · 1 flagged" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Avail schedule export · 1 flagged" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Operations · none flagged" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Not a schedule fix · 1 flagged" })).toBeInTheDocument();
    const gap = screen.getByLabelText("Longest gap between timepoints: 45 min, flagged").closest("details");
    expect(gap).not.toHaveAttribute("open");
    const placeholders = screen.getByLabelText("Placeholder stop times: 27%, flagged").closest("details");
    expect(placeholders).toHaveAttribute("open");
  });

  it("shows six evidence rows, then all, then fewer again, keeping focus on the button", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    getGtfsPredictionRiskRouteObserved.mockResolvedValue(OBSERVED);
    view(<ScheduleRouteView routeId="420" routeLabel="420" />);

    const evidence = await screen.findByRole("list", { name: "Placeholder stop times evidence" });
    expect(within(evidence).getAllByRole("listitem")).toHaveLength(6);
    const more = screen.getByRole("button", { name: "Show all 8 rows" });
    await userEvent.click(more);
    expect(within(evidence).getAllByRole("listitem")).toHaveLength(8);
    expect(more).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(within(evidence).getAllByRole("listitem")).toHaveLength(6);
  });

  it("asks again with the window the reader picks, and offers Try again when Avail fails", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    getGtfsPredictionRiskRouteObserved.mockResolvedValueOnce(OBSERVED).mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValue(OBSERVED);
    view(<ScheduleRouteView routeId="420" routeLabel="420" />);
    await screen.findByRole("list", { name: /where Avail confirms/ });

    await userEvent.click(screen.getByRole("button", { name: "90 days" }));
    expect(getGtfsPredictionRiskRouteObserved).toHaveBeenLastCalledWith("420", { days: 90, dow: "weekday" });
    expect(await screen.findByRole("alert")).toHaveTextContent("What Avail observed could not be loaded.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: /where Avail confirms/ })).toBeInTheDocument();
    expect(getGtfsPredictionRiskRouteObserved).toHaveBeenCalledTimes(3);
  });

  it("says a route may not run on the days picked rather than counting phantom Saturdays", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    getGtfsPredictionRiskRouteObserved.mockResolvedValueOnce(OBSERVED).mockRejectedValue(new ApiError(404, "none"));
    view(<ScheduleRouteView routeId="420" routeLabel="420" />);
    await screen.findByRole("list", { name: /where Avail confirms/ });
    await userEvent.click(screen.getByRole("button", { name: "Saturdays" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Avail has nothing for this route on Saturdays in the last 28 days. It may not run then.");
  });

  it("shows the schedule without Avail's counts to someone without Compliance access", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    view(<ScheduleRouteView routeId="420" routeLabel="420" />, ["schedule-review.view"]);
    expect(await screen.findByText(/needs Compliance access, because it reads OTP data/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Westbound/ })).toBeInTheDocument();
    expect(getGtfsPredictionRiskRouteObserved).not.toHaveBeenCalled();
  });

  it("offers Try again when the route's detail cannot be read", async () => {
    getGtfsPredictionRiskRoute.mockRejectedValueOnce(new ApiError(500, "Internal server error")).mockResolvedValue(DETAIL);
    getGtfsPredictionRiskRouteObserved.mockResolvedValue(OBSERVED);
    view(<ScheduleRouteView routeId="420" routeLabel="420" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The schedule review could not be loaded.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: /Apple Valley-Rosemount-DCTC/ })).toBeInTheDocument();
  });

  it("moves focus to the route when it was opened from the list", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    getGtfsPredictionRiskRouteObserved.mockResolvedValue(OBSERVED);
    view(<ScheduleRouteView routeId="420" routeLabel="420" focusOnLoad />);
    const heading = await screen.findByRole("heading", { level: 2, name: /Apple Valley-Rosemount-DCTC/ });
    expect(heading).toHaveFocus();
  });
});

describe("the evidence a planner copies", () => {
  it("names the route, what Avail confirms, and each flagged check with its owner, fix and evidence", () => {
    const text = evidenceText(DETAIL, [{ ...READING }], "20 weekdays Sep 18 to Oct 15, 1,772 departures");
    expect(text.split("\n").slice(0, 5)).toEqual([
      "Route 420 (Apple Valley-Rosemount-DCTC): schedule review of feed 20260909",
      "",
      "Confirmed by Avail, 20 weekdays Sep 18 to Oct 15, 1,772 departures:",
      `- ${READING.text}`,
      "",
    ]);
    expect(text).toContain("- Placeholder stop times: 27% (flagged at 10% or more). Avail schedule export: Export interpolated times.");
    expect(text).toContain("    Pair 6: 43 trips");
    expect(text).not.toContain("Pair 7");
  });
});
