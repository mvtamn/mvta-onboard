import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { PredictionRiskCheckDefinition, ReviewDiff, ReviewHistoryResponse } from "@mvta/shared";
import { ScheduleReviewChanges } from "./ScheduleReviewChanges.js";

const { getGtfsPredictionRiskHistory } = vi.hoisted(() => ({ getGtfsPredictionRiskHistory: vi.fn() }));
vi.mock("../../../config.js", () => ({ api: { getGtfsPredictionRiskHistory } }));

const CHECKS: PredictionRiskCheckDefinition[] = [
  { id: "longest_hop", label: "Longest distance between stops", unit: "mi", threshold: 10, comparison: "at_least", why: ".", owner: "structural", fix: "." },
  { id: "run_time_flat", label: "Same running time all day", unit: "%", threshold: 50, comparison: "at_least", why: ".", owner: "scheduling", fix: "." },
  { id: "recovery_time", label: "Typical recovery time", unit: "min", threshold: 5, comparison: "at_most", why: ".", owner: "scheduling", fix: "." },
];

const HISTORY = [
  { review_id: 30, first_seen_at: "2026-11-02T09:00:00Z", last_seen_at: "2026-11-05T09:00:00Z", feed_version: "20261102", route_count: 19, flagged_route_count: 18 },
  { review_id: 20, first_seen_at: "2026-10-16T09:00:00Z", last_seen_at: "2026-11-01T09:00:00Z", feed_version: "20260909", route_count: 19, flagged_route_count: 19 },
  { review_id: 10, first_seen_at: "2026-10-14T09:00:00Z", last_seen_at: "2026-10-15T09:00:00Z", feed_version: "20260909", route_count: 19, flagged_route_count: 17 },
];

const FEED_DIFF: ReviewDiff = {
  from: { review_id: 20, reviewed_at: "2026-10-16T09:00:00Z", feed_version: "20260909" },
  to: { review_id: 30, reviewed_at: "2026-11-02T09:00:00Z", feed_version: "20261102" },
  cause: "feed",
  gained: [{ route_id: "442", route_short_name: "442", check_id: "recovery_time", from_value: 8, to_value: 3 }],
  lost: [
    { route_id: "420", route_short_name: "420", check_id: "run_time_flat", from_value: 100, to_value: 0 },
    { route_id: "440", route_short_name: "440", check_id: "run_time_flat", from_value: 100, to_value: 20 },
  ],
  checks_added: [], checks_removed: [], routes_added: [], routes_removed: [{ route_id: "499", route_short_name: "499" }],
  flagged_routes: { from: 19, to: 18 },
};

const CHECKS_DIFF: ReviewDiff = {
  ...FEED_DIFF,
  from: { review_id: 10, reviewed_at: "2026-10-14T09:00:00Z", feed_version: "20260909" },
  to: { review_id: 20, reviewed_at: "2026-10-16T09:00:00Z", feed_version: "20260909" },
  cause: "checks",
  gained: [{ route_id: "470", route_short_name: "470", check_id: "longest_hop", from_value: 9.6, to_value: 16 }],
  lost: [],
  checks_added: ["run_time_flat", "recovery_time"],
  routes_removed: [],
  flagged_routes: { from: 17, to: 19 },
};

function respond(diff: ReviewDiff | null, history = HISTORY): ReviewHistoryResponse {
  return { history, diff };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScheduleReviewChanges on the Schedule Review page", () => {
  it("lists the flags a new feed gained and lost, with the values either side, and opens a route from a line", async () => {
    getGtfsPredictionRiskHistory.mockResolvedValue(respond(FEED_DIFF));
    const onOpenRoute = vi.fn();
    render(<ScheduleReviewChanges mode="page" checks={CHECKS} onOpenRoute={onOpenRoute} />);

    expect(await screen.findByText("Since feed 20260909: 1 flag gained, 2 lost.")).toBeInTheDocument();
    expect(screen.getByText(/Routes flagged went from 19 to 18\./)).toBeInTheDocument();
    expect(screen.getByText("No longer in the feed: 499.")).toBeInTheDocument();

    const gained = screen.getByRole("list", { name: "Flags gained" });
    expect(within(gained).getByRole("listitem")).toHaveTextContent("442Typical recovery time8 min → 3 min");
    const lost = screen.getByRole("list", { name: "Flags lost" });
    expect(within(lost).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "420Same running time all day100% → 0%",
      "440Same running time all day100% → 20%",
    ]);

    await userEvent.click(within(lost).getByRole("button", { name: "Open schedule review for route 420" }));
    expect(onOpenRoute).toHaveBeenCalledWith("420");
  });

  it("says when the feed did not change and the checks did, and does not count a new check as a flag gained", async () => {
    getGtfsPredictionRiskHistory.mockResolvedValue(respond(CHECKS_DIFF));
    render(<ScheduleReviewChanges mode="page" checks={CHECKS} />);

    expect(await screen.findByText("Same feed 20260909, reviewed by newer checks: 1 flag gained, 0 lost.")).toBeInTheDocument();
    expect(screen.getByText(/The published schedule did not change/)).toBeInTheDocument();
    expect(screen.getByText(/Checks added: Same running time all day, Typical recovery time\./)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Flags gained" })).getByRole("listitem")).toHaveTextContent("470Longest distance between stops9.6 mi → 16 mi");
  });

  it("compares with the review the reader picks", async () => {
    getGtfsPredictionRiskHistory.mockResolvedValue(respond(FEED_DIFF));
    render(<ScheduleReviewChanges mode="page" checks={CHECKS} />);
    const picker = await screen.findByRole("combobox", { name: "Compared with" });
    expect(within(picker).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["20", "10"]);

    getGtfsPredictionRiskHistory.mockResolvedValue(respond({ ...FEED_DIFF, from: { ...FEED_DIFF.from, review_id: 10 } }));
    await userEvent.selectOptions(picker, "10");
    expect(getGtfsPredictionRiskHistory).toHaveBeenLastCalledWith({ from: 10 });
  });

  it("says only one review has been kept when there is nothing to compare", async () => {
    getGtfsPredictionRiskHistory.mockResolvedValue(respond(null, HISTORY.slice(2)));
    render(<ScheduleReviewChanges mode="page" checks={CHECKS} />);
    expect(await screen.findByText(/Only one review has been kept so far \(feed 20260909, since/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("ScheduleReviewChanges on Integrations & Data Health", () => {
  it("is one line linking to the Schedule Review page", async () => {
    getGtfsPredictionRiskHistory.mockResolvedValue(respond(FEED_DIFF));
    render(<MemoryRouter><ScheduleReviewChanges mode="summary" checks={CHECKS} /></MemoryRouter>);
    expect(await screen.findByText(/Since feed 20260909: 1 flag gained, 2 lost\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See what changed on Schedule Review" })).toHaveAttribute("href", "/schedule-review");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows nothing when there is nothing to compare", async () => {
    getGtfsPredictionRiskHistory.mockResolvedValue(respond(null, HISTORY.slice(2)));
    const { container } = render(<MemoryRouter><ScheduleReviewChanges mode="summary" checks={CHECKS} /></MemoryRouter>);
    await vi.waitFor(() => expect(getGtfsPredictionRiskHistory).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ScheduleReviewChanges on the Schedule Review page as a notice", () => {
  it("is one line that opens the full comparison in place and closes it again", async () => {
    getGtfsPredictionRiskHistory.mockResolvedValue(respond(FEED_DIFF));
    render(<MemoryRouter><ScheduleReviewChanges mode="notice" checks={CHECKS} /></MemoryRouter>);
    expect(await screen.findByText(/Since feed 20260909: 1 flag gained, 2 lost\./)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Flags lost" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "See what changed" }));
    expect(screen.getByRole("list", { name: "Flags lost" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("list", { name: "Flags lost" })).not.toBeInTheDocument();
  });
});
