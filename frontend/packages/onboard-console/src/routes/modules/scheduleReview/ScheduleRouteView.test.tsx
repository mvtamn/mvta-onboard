import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type RouteScheduleDetailResponse } from "@mvta/shared";
import { ScheduleRouteView, gridHours, isFlatSegment } from "./ScheduleRouteView.js";

const { getGtfsPredictionRiskRoute } = vi.hoisted(() => ({ getGtfsPredictionRiskRoute: vi.fn() }));
vi.mock("../../../config.js", () => ({ api: { getGtfsPredictionRiskRoute } }));

const DETAIL: RouteScheduleDetailResponse = {
  reviewed_at: "2026-10-16T09:00:00Z",
  confirmed_at: "2026-10-16T10:00:00Z",
  feed: { version: "20260909", start_date: "20260909", end_date: "20261101" },
  checks: [
    { id: "placeholder_times", label: "Placeholder stop times", unit: "%", threshold: 10, comparison: "at_least", why: "One second apart.", owner: "avail", fix: "Export interpolated times." },
    { id: "run_time_flat", label: "Same running time all day", unit: "%", threshold: 50, comparison: "at_least", why: "Traffic never changes.", owner: "scheduling", fix: "Give the pattern peak running times." },
    { id: "recovery_time", label: "Typical recovery time", unit: "min", threshold: 5, comparison: "at_most", why: "Lateness carries over.", owner: "scheduling", fix: "Lengthen the layover." },
    { id: "block_overlaps", label: "Impossible blocks", unit: "trips", threshold: 1, comparison: "at_least", why: "Which trip is the bus on.", owner: "scheduling", fix: "Fix the block." },
  ],
  route: {
    route_id: "420", route_short_name: "420", trip_count: 90, stop_count: 69, timepoint_count: 4, pattern_count: 2, flag_count: 2,
    checks: [
      { id: "placeholder_times", value: 27, flagged: true, evidence: Array.from({ length: 8 }, (_, i) => ({ text: `Pair ${i + 1}: ${48 - i} trips`, count: 48 - i, value: null, stop_ids: [], trip_ids: [] })) },
      { id: "block_overlaps", value: null, flagged: false, evidence: [] },
      { id: "recovery_time", value: 5, flagged: true, evidence: [{ text: "3–5 min: 40 trips (51%)", count: 40, value: null, stop_ids: [], trip_ids: [] }] },
      { id: "run_time_flat", value: 0, flagged: false, evidence: [] },
    ],
    segments: [
      { from_stop_id: "A", from_stop_name: "Apple Valley TS", to_stop_id: "B", to_stop_name: "157th St", miles: 3.4, hours: [
        { hour: 5, trips: 3, min_minutes: 10, max_minutes: 10 }, { hour: 6, trips: 3, min_minutes: 10, max_minutes: 10 }, { hour: 17, trips: 3, min_minutes: 10, max_minutes: 10 },
      ] },
      { from_stop_id: "B", from_stop_name: "157th St", to_stop_id: "C", to_stop_name: "Rosemount TS", miles: 11.1, hours: [
        { hour: 6, trips: 3, min_minutes: 20, max_minutes: 22 }, { hour: 17, trips: 3, min_minutes: 24, max_minutes: 24 },
      ] },
    ],
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScheduleRouteView", () => {
  it("lists the checks flagged first, with value, owner and fix, and leaves what could not be measured last", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    render(<ScheduleRouteView routeId="420" routeLabel="420" onClose={() => {}} />);

    const list = await screen.findByRole("list", { name: "Route 420 schedule checks, flagged first" });
    const summaries = Array.from(list.querySelectorAll("summary")).map((summary) => summary.getAttribute("aria-label"));
    expect(summaries).toEqual([
      "Placeholder stop times: 27%, flagged",
      "Typical recovery time: 5 min, flagged",
      "Same running time all day: 0%",
      "Impossible blocks: —, not measured",
    ]);
    expect(screen.getByText("Avail schedule export:")).toBeInTheDocument();
    expect(screen.getByText(/Export interpolated times\./)).toBeInTheDocument();
    expect(screen.getByText("flagged at 5 min or less")).toBeInTheDocument();
    expect(screen.getByText("nothing to measure")).toBeInTheDocument();
    expect(getGtfsPredictionRiskRoute).toHaveBeenCalledWith("420");
  });

  it("shows the first six evidence rows and the rest on request", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    render(<ScheduleRouteView routeId="420" routeLabel="420" onClose={() => {}} />);

    const evidence = await screen.findByRole("list", { name: "Placeholder stop times evidence" });
    expect(within(evidence).getAllByRole("listitem")).toHaveLength(6);
    await userEvent.click(screen.getByRole("button", { name: "Show all 8 rows" }));
    expect(within(evidence).getAllByRole("listitem")).toHaveLength(8);
    expect(within(evidence).getAllByRole("listitem")[7]).toHaveTextContent("Pair 8: 41 trips");
  });

  it("lays the segments against every start hour and marks the one scheduled the same all day", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    render(<ScheduleRouteView routeId="420" routeLabel="420" onClose={() => {}} />);

    const grid = await screen.findByRole("table", { name: "Route 420 scheduled minutes per timepoint segment by start hour" });
    const header = within(grid).getAllByRole("columnheader").map((th) => th.textContent);
    expect(header).toEqual(["Segment", "Miles", "5a", "6a", "5p"]);
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("same all day")).toBeInTheDocument();
    expect(within(rows[0]).getAllByRole("cell").map((td) => td.textContent)).toEqual(["3.4", "10", "10", "10"]);
    expect(within(rows[1]).queryByText("same all day")).not.toBeInTheDocument();
    expect(within(rows[1]).getAllByRole("cell").map((td) => td.textContent)).toEqual(["11.1", "·", "20–22", "24"]);
    expect(screen.getByText(/90 trips · 69 stops · 4 timepoints · 2 stop patterns · 2 flagged/)).toBeInTheDocument();
    expect(screen.getByText(/Feed 20260909 · Sep 9, 2026 – Nov 1, 2026/)).toBeInTheDocument();
  });

  it("names migration 145 when the database does not keep the evidence, and says when a route has none", async () => {
    getGtfsPredictionRiskRoute.mockRejectedValueOnce(new ApiError(503, "missing"));
    const { unmount } = render(<ScheduleRouteView routeId="420" routeLabel="420" onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("migration-145-schedule-review-route-detail.sql");
    unmount();

    getGtfsPredictionRiskRoute.mockRejectedValueOnce(new ApiError(404, "none"));
    render(<ScheduleRouteView routeId="999" routeLabel="999" onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("no detail for route 999");
  });

  it("closes from its own button", async () => {
    getGtfsPredictionRiskRoute.mockResolvedValue(DETAIL);
    const onClose = vi.fn();
    render(<ScheduleRouteView routeId="420" routeLabel="420" onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("grid helpers", () => {
  it("collects every start hour across segments once, in order", () => {
    expect(gridHours(DETAIL.route.segments)).toEqual([5, 6, 17]);
  });

  it("calls a segment flat only when every hour it runs, peak and off-peak, has the same single value", () => {
    expect(isFlatSegment(DETAIL.route.segments[0])).toBe(true);
    expect(isFlatSegment(DETAIL.route.segments[1])).toBe(false);
    expect(isFlatSegment({ ...DETAIL.route.segments[0], hours: DETAIL.route.segments[0].hours.slice(0, 1) })).toBe(false);
    // Three peak-only trips have no off-peak to differ from.
    const peakOnly = [6, 7, 8].map((hour) => ({ hour, trips: 1, min_minutes: 10, max_minutes: 10 }));
    expect(isFlatSegment({ ...DETAIL.route.segments[0], hours: peakOnly })).toBe(false);
  });
});
