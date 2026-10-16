import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ApiError, type PredictionRiskCheckDefinition, type PredictionRiskReview } from "@mvta/shared";
import { SchedulePredictionRisk, formatRiskValue } from "./SchedulePredictionRisk.js";

const { getGtfsPredictionRisk } = vi.hoisted(() => ({ getGtfsPredictionRisk: vi.fn() }));
vi.mock("../../config.js", () => ({ api: { getGtfsPredictionRisk } }));

const CHECKS: PredictionRiskCheckDefinition[] = [
  { id: "placeholder_times", label: "Placeholder stop times", unit: "%", threshold: 10, comparison: "at_least", why: "Stops scheduled one second apart.", owner: "avail", fix: "Export interpolated times." },
  { id: "timepoint_gap", label: "Longest gap between timepoints", unit: "min", threshold: 30, comparison: "at_least", why: "Traffic decides the arrival.", owner: "structural", fix: "Predict from GPS progress." },
  { id: "recovery_time", label: "Typical recovery time", unit: "min", threshold: 5, comparison: "at_most", why: "Lateness carries over.", owner: "scheduling", fix: "Lengthen the layover." },
];

const REVIEW: PredictionRiskReview = {
  reviewed_at: "2026-10-14T09:00:00Z",
  confirmed_at: null,
  feed: { version: "20260909", start_date: "20260909", end_date: "20261101" },
  checks: CHECKS,
  routes: [
    { route_id: "490", route_short_name: "490", trip_count: 56, flag_count: 2, checks: [
      { id: "placeholder_times", value: 10, flagged: true },
      { id: "timepoint_gap", value: 45, flagged: true },
      { id: "recovery_time", value: 72, flagged: false },
    ] },
    { route_id: "470", route_short_name: "470", trip_count: 32, flag_count: 0, checks: [
      { id: "placeholder_times", value: 0, flagged: false },
      { id: "timepoint_gap", value: null, flagged: false },
      { id: "recovery_time", value: 3, flagged: true },
    ] },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SchedulePredictionRisk", () => {
  it("shows each route's checks in the order the review ranked them, marking what is flagged", async () => {
    getGtfsPredictionRisk.mockResolvedValue({ review: REVIEW });
    render(<SchedulePredictionRisk />);

    const table = await screen.findByRole("table", { name: "Schedule prediction risk by route" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["49056 trips", "47032 trips"]);
    expect(within(rows[0]).getByLabelText("45 min, flagged")).toBeInTheDocument();
    expect(within(rows[1]).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 routes")).toBeInTheDocument();
  });

  it("names the feed it reviewed and says what each check means and where it flags", async () => {
    getGtfsPredictionRisk.mockResolvedValue({ review: REVIEW });
    render(<SchedulePredictionRisk />);

    expect(await screen.findByText(/Feed 20260909 · Sep 9, 2026 – Nov 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Traffic decides the arrival.")).toBeInTheDocument();
    expect(screen.getByText("flagged at 30 min or more")).toBeInTheDocument();
  });

  it("reads a check that flags downward as 'or less' and says who owns each fix", async () => {
    getGtfsPredictionRisk.mockResolvedValue({ review: REVIEW });
    render(<SchedulePredictionRisk />);

    expect(await screen.findByText("flagged at 5 min or less")).toBeInTheDocument();
    expect(screen.getByText("MVTA scheduling:")).toBeInTheDocument();
    expect(screen.getByText(/Lengthen the layover\./)).toBeInTheDocument();
    expect(screen.getByText("Avail schedule export:")).toBeInTheDocument();
    expect(screen.getByText("Not a schedule fix:")).toBeInTheDocument();
  });

  it("says when no review has been kept yet rather than showing an empty table", async () => {
    getGtfsPredictionRisk.mockResolvedValue({ review: null });
    render(<SchedulePredictionRisk />);

    expect(await screen.findByText(/No schedule review yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("names the migration to run when the database does not have it", async () => {
    getGtfsPredictionRisk.mockRejectedValue(new ApiError(503, "missing"));
    render(<SchedulePredictionRisk />);

    expect(await screen.findByRole("alert")).toHaveTextContent("migration-143-gtfs-prediction-risk-reviews.sql");
  });
});

describe("formatRiskValue", () => {
  it("writes each unit the way a reader says it", () => {
    expect(formatRiskValue(CHECKS[0], 27)).toBe("27%");
    expect(formatRiskValue({ ...CHECKS[0], unit: "mi" }, 14.9)).toBe("14.9 mi");
    expect(formatRiskValue({ ...CHECKS[0], unit: "trips" }, 1)).toBe("1");
    expect(formatRiskValue(CHECKS[1], null)).toBe("—");
  });
});
