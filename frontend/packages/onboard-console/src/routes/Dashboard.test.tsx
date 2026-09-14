import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Dashboard } from "./Dashboard.js";
import type { LiveStats } from "../hooks/useLiveStats.js";
import type { FeedFreshness } from "../hooks/useFeedFreshness.js";

vi.mock("../components/Sidebar.js", () => ({ Sidebar: () => <aside>Health summary</aside> }));
vi.mock("../components/MessagesTable.js", () => ({ MessagesTable: () => <div>Active Service Alerts table</div> }));
const feedHealth: FeedFreshness = {
  feeds: [],
  summary: { state: "live", label: "All feeds current" },
  checkedAt: null,
  refresh: vi.fn(),
};
vi.mock("../hooks/useFeedFreshness.js", () => ({ useFeedFreshness: () => feedHealth }));

function stats(overrides: Partial<LiveStats> = {}): LiveStats {
  return {
    activeCount: 0,
    activeMessages: [],
    lastMessageId: null,
    pending: [],
    subscribers: null,
    syncedAt: new Date("2026-08-16T12:00:00Z"),
    ok: true,
    activeState: "live",
    pendingState: "live",
    overallState: "live",
    refresh: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("Dashboard", () => {
  it("puts triage exceptions before supporting communications", () => {
    render(<MemoryRouter><Dashboard stats={stats()} /></MemoryRouter>);

    expect(screen.getByRole("region", { name: "Triage exceptions" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Triage exceptions" })).toHaveTextContent("No triage exceptions");
    expect(screen.getByText("Active Service Alerts table")).toBeInTheDocument();
  });

  it("shows a stale trust state instead of claiming live data", () => {
    render(
      <MemoryRouter>
        <Dashboard stats={stats({ overallState: "stale", activeState: "stale" })} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Stale data");
  });

  // The bar used to say "Live data connected" whenever the API answered, even
  // with a feed hours stale or never delivered.
  it("reports the feeds, not just the API, once the API is answering", () => {
    feedHealth.summary = { state: "unavailable", label: "MVTA Connect unavailable" };
    render(<MemoryRouter><Dashboard stats={stats()} /></MemoryRouter>);

    const bar = screen.getByRole("status");
    expect(bar).toHaveTextContent("MVTA Connect unavailable");
    expect(bar).not.toHaveTextContent("Live data connected");
    expect(bar.className).toContain("unavailable");
    expect(screen.getByLabelText("Dashboard summary")).toHaveTextContent("MVTA Connect unavailable");
    feedHealth.summary = { state: "live", label: "All feeds current" };
  });

  it("says all feeds are current only when the feeds say so", () => {
    render(<MemoryRouter><Dashboard stats={stats()} /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("All feeds current");
  });
});
