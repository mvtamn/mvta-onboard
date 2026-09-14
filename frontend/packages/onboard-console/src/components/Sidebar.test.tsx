import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveStats } from "../hooks/useLiveStats.js";
import type { DashboardFeed, FeedSummary } from "../hooks/feedFreshness.js";
import { Sidebar } from "./Sidebar.js";

afterEach(cleanup);

const stats: LiveStats = {
  activeCount: 0, activeMessages: [], lastMessageId: null, pending: [], subscribers: null,
  syncedAt: new Date(), ok: true, activeState: "live", pendingState: "live", overallState: "live", refresh: vi.fn(),
};

// As dev reported on 2026-09-14.
const DEV_FEEDS: DashboardFeed[] = [
  { key: "gtfs-realtime", label: "GTFS-Realtime", detail: "Fixed-route trip updates", state: "live", stateLabel: "Current", lastDeliveryAt: new Date().toISOString() },
  { key: "mvta-connect", label: "MVTA Connect", detail: "On-demand reconciliation", state: "unavailable", stateLabel: "Unavailable", lastDeliveryAt: null },
];
const DEV_SUMMARY: FeedSummary = { state: "unavailable", label: "MVTA Connect unavailable" };

function renderRail(feeds = DEV_FEEDS, summary = DEV_SUMMARY, onRefresh = vi.fn()) {
  const view = render(<Sidebar stats={stats} feeds={feeds} summary={summary} checkedAt={new Date()} onRefresh={onRefresh} />);
  return { ...view, onRefresh };
}

describe("Sidebar", () => {
  it("reports each feed's own state and delivery", () => {
    renderRail();
    expect(screen.getByText(/GTFS-Realtime · Current/)).toBeInTheDocument();
    expect(screen.getByText(/Fixed-route trip updates · last delivery/)).toBeInTheDocument();
    expect(screen.getByText(/MVTA Connect · Unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/On-demand reconciliation · no delivery recorded/)).toBeInTheDocument();
  });

  // The rail used to say this about two console API calls under feed names.
  it("no longer reports an API call as a feed being live", () => {
    renderRail();
    expect(screen.queryByText(/Live data connected/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("MVTA Connect unavailable");
  });

  it("gives each feed a signal matching its state", () => {
    const { container } = renderRail();
    const rows = container.querySelectorAll(".data-health-feed");
    expect(rows[0].querySelector(".live-signal")?.className).toContain("is-live");
    expect(rows[1].querySelector(".live-signal")?.className).toContain("is-down");
  });

  it("shows a role without feed-health access neutrally, with no signal", () => {
    const noAccess = DEV_FEEDS.map((feed) => ({ ...feed, state: "no_access" as const, stateLabel: "No access", lastDeliveryAt: null }));
    const { container } = renderRail(noAccess, { state: "loading", label: "Feed health is not available to your role" });
    expect(container.querySelectorAll(".data-health-feed .live-signal")).toHaveLength(0);
    expect(container.querySelectorAll(".data-health-feed.unavailable")).toHaveLength(0);
  });

  it("refreshes through the Dashboard, so feeds and counts are re-checked together", () => {
    const { onRefresh } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
