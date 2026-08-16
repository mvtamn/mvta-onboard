import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Dashboard } from "./Dashboard.js";
import type { LiveStats } from "../hooks/useLiveStats.js";

vi.mock("../components/Sidebar.js", () => ({ Sidebar: () => <aside>Health summary</aside> }));
vi.mock("../components/MessagesTable.js", () => ({ MessagesTable: () => <div>Active Service Alerts table</div> }));

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
});
