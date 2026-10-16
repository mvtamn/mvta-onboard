import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { MyAccess, ObservedSummaryResponse, PredictionRiskCheckDefinition, PredictionRiskReview } from "@mvta/shared";
import { StaticAccessProvider } from "../auth/AccessContext.js";
import { ScheduleReview } from "./ScheduleReview.js";

const api = vi.hoisted(() => ({
  getGtfsPredictionRisk: vi.fn(),
  getGtfsPredictionRiskObservedSummary: vi.fn(),
  getGtfsPredictionRiskHistory: vi.fn(() => Promise.resolve({ history: [], diff: null })),
  // The open route is ScheduleRouteView's own test; here it only has to load.
  getGtfsPredictionRiskRoute: vi.fn(() => new Promise(() => {})),
  getGtfsPredictionRiskRouteObserved: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../config.js", () => ({ api }));

const CHECKS = [
  { id: "placeholder_times", label: "Placeholder stop times", unit: "%", threshold: 10, comparison: "at_least", why: ".", owner: "avail", fix: "." },
  { id: "run_time_flat", label: "Same running time all day", unit: "%", threshold: 50, comparison: "at_least", why: ".", owner: "scheduling", fix: "." },
  { id: "interlined", label: "Continues from another route", unit: "%", threshold: 50, comparison: "at_least", why: ".", owner: "operations", fix: "." },
  { id: "timepoint_gap", label: "Longest gap between timepoints", unit: "min", threshold: 30, comparison: "at_least", why: ".", owner: "structural", fix: "." },
] as PredictionRiskCheckDefinition[];

const route = (id: string, name: string, flagged: string[], fixable: number, structural = 0) => ({
  route_id: id, route_short_name: id, route_long_name: name, trip_count: 50, flag_count: flagged.length, fixable_flag_count: fixable, structural_flag_count: structural,
  checks: CHECKS.map((c) => ({ id: c.id, value: 1, flagged: flagged.includes(c.id) })),
});

const REVIEW: PredictionRiskReview = {
  reviewed_at: "2026-10-16T09:00:00Z", confirmed_at: null,
  feed: { version: "20260909", start_date: "20260909", end_date: "20261101" },
  checks: CHECKS,
  routes: [
    route("490", "Prior Lake-Shakopee-Mpls-UMN", ["placeholder_times", "interlined", "timepoint_gap"], 2, 1),
    route("420", "Apple Valley-Rosemount-DCTC", ["placeholder_times", "run_time_flat"], 2),
    route("442", "Burnsville-Apple Valley", ["run_time_flat"], 1),
  ],
};

const SUMMARY: ObservedSummaryResponse = {
  window: { days: 28, dow: "weekday", first_day: "20260918", last_day: "20261015", service_days: 20 },
  schedule_available: true,
  routes: [
    { route_id: "420", measured: true, departures: 1772, readings: 2, confirmed_segments: 2, worst: { kind: "peak_under_run", period: "pm", direction: "W", from_stop_id: "R", to_stop_id: "S", from_stop_name: "Rosemount TS", to_stop_name: "157th Street Station", scheduled_minutes: 20, peak_pct: 46, off_peak_pct: 4, upstream_pct: 20, text: "" } },
    { route_id: "442", measured: true, departures: 1438, readings: 1, confirmed_segments: 1, worst: null },
    { route_id: "490", measured: false, departures: 0, readings: 0, confirmed_segments: 0, worst: null },
  ],
};

function access(actions: string[]): MyAccess {
  return { person: { objectId: null, tenantId: null, name: "Test", email: null }, roles: [], actions, summary: [], ingestion: false, rolesInOnBoard: true };
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function page(path = "/schedule-review", actions = ["compliance-review.view"]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StaticAccessProvider access={access(actions)}>
        <Routes><Route path="/schedule-review" element={<><ScheduleReview /><Where /></>} /></Routes>
      </StaticAccessProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScheduleReview page", () => {
  it("ranks routes by what Avail confirms, then fixable flags, and opens the top one", async () => {
    api.getGtfsPredictionRisk.mockResolvedValue({ review: REVIEW });
    api.getGtfsPredictionRiskObservedSummary.mockResolvedValue(SUMMARY);
    page();

    const list = await screen.findByRole("navigation", { name: "Routes, ranked" });
    await within(list).findByText("2", { selector: "strong.sr-warn" });
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.textContent?.slice(0, 3))).toEqual(["420", "442", "490"]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(within(links[0]).getByText("PM 46% late at 157th Street Station westbound, against 4% midday")).toBeInTheDocument();
    expect(within(links[2]).getByText("+1 not a schedule fix")).toBeInTheDocument();
    expect(within(links[2]).getByText("not measured by Avail")).toBeInTheDocument();
    expect(api.getGtfsPredictionRiskRoute).toHaveBeenCalledWith("420");
  });

  it("opens the route the URL names, and a route link changes the URL so Back works", async () => {
    api.getGtfsPredictionRisk.mockResolvedValue({ review: REVIEW });
    api.getGtfsPredictionRiskObservedSummary.mockResolvedValue(SUMMARY);
    page("/schedule-review?route=490");

    const list = await screen.findByRole("navigation", { name: "Routes, ranked" });
    expect(within(list).getByRole("link", { name: /^490/ })).toHaveAttribute("aria-current", "page");
    expect(api.getGtfsPredictionRiskRoute).toHaveBeenCalledWith("490");

    await userEvent.click(within(list).getByRole("link", { name: /^442/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("?route=442");
    expect(api.getGtfsPredictionRiskRoute).toHaveBeenLastCalledWith("442");
  });

  it("offers the same ranked routes as one Route picker for a narrow page", async () => {
    api.getGtfsPredictionRisk.mockResolvedValue({ review: REVIEW });
    api.getGtfsPredictionRiskObservedSummary.mockResolvedValue(SUMMARY);
    page();
    const list = await screen.findByRole("navigation", { name: "Routes, ranked" });
    await within(list).findByText("2", { selector: "strong.sr-warn" });
    const picker = within(list).getByRole("combobox", { name: "Route" });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "420 · Apple Valley-Rosemount-DCTC · 2 confirmed · 2 fixable",
      "442 · Burnsville-Apple Valley · 1 confirmed · 1 fixable",
      "490 · Prior Lake-Shakopee-Mpls-UMN · 2 fixable",
    ]);
    expect(picker).toHaveValue("420");
    await userEvent.selectOptions(picker, "490");
    expect(screen.getByTestId("where")).toHaveTextContent("?route=490");
    expect(api.getGtfsPredictionRiskRoute).toHaveBeenLastCalledWith("490");
  });

  it("filters to routes with a flag a chosen owner can fix", async () => {
    api.getGtfsPredictionRisk.mockResolvedValue({ review: REVIEW });
    api.getGtfsPredictionRiskObservedSummary.mockResolvedValue(SUMMARY);
    page();
    const list = await screen.findByRole("navigation", { name: "Routes, ranked" });
    await userEvent.click(within(list).getByRole("button", { name: "Operations" }));
    expect(within(list).getAllByRole("link").map((a) => a.textContent?.slice(0, 3))).toEqual(["490"]);
    expect(within(list).getByRole("heading", { name: "1 of 3 routes" })).toBeInTheDocument();
  });

  it("ranks by fixable flags, and says why, for someone without Compliance access", async () => {
    api.getGtfsPredictionRisk.mockResolvedValue({ review: REVIEW });
    page("/schedule-review", ["schedule-review.view"]);
    const list = await screen.findByRole("navigation", { name: "Routes, ranked" });
    expect(within(list).getAllByRole("link").map((a) => a.textContent?.slice(0, 3))).toEqual(["490", "420", "442"]);
    expect(within(list).getByText(/Ranking by what Avail confirms needs Compliance access/)).toBeInTheDocument();
    expect(api.getGtfsPredictionRiskObservedSummary).not.toHaveBeenCalled();
  });

  it("offers Try again when the review cannot be loaded", async () => {
    api.getGtfsPredictionRisk.mockRejectedValueOnce(new Error("down")).mockResolvedValue({ review: REVIEW });
    api.getGtfsPredictionRiskObservedSummary.mockResolvedValue(SUMMARY);
    page();
    expect(await screen.findByRole("alert")).toHaveTextContent("The schedule review could not be loaded.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("navigation", { name: "Routes, ranked" })).toBeInTheDocument();
  });
});
