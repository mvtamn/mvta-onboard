import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth/AuthContext.js", () => ({ useAuth: vi.fn() }));
// Route modules are stubbed: this file tests the shell, not the workspaces.
const stub = () => null;
vi.mock("./routes/AdminModules.js", () => ({
  AdminAccess: stub,
  AdminEventAdministration: stub,
  AdminGovernance: stub,
  AdminIntegrations: stub,
  AdminServiceConfiguration: stub,
  AdminSubscribers: stub,
}));
vi.mock("./routes/modules/EventMonitoring.js", () => ({ EventMonitoring: stub }));
vi.mock("./routes/modules/tripStartLog/TripStartLog.js", () => ({ TripStartLog: () => <p>Dispatch Log workspace</p> }));
vi.mock("./hooks/useLiveStats.js", () => ({
  useLiveStats: vi.fn(),
  dataStateLabel: vi.fn(() => "Loading live data"),
}));
vi.mock("./theme/ThemeContext.js", () => ({
  useTheme: vi.fn(() => ({ theme: "light", toggle: vi.fn() })),
}));

const { useAuth } = await import("./auth/AuthContext.js");
const { useLiveStats } = await import("./hooks/useLiveStats.js");
const { App } = await import("./App.js");

describe("App authentication boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      account: null,
      roles: [],
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
  });

  it("makes no cross-workspace live-data claim in the shell", () => {
    vi.mocked(useAuth).mockReturnValue({
      account: { name: "Dispatcher", username: "dispatcher@mvta.test" },
      roles: ["OCC.Viewer"],
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(useLiveStats).mockReturnValue({
      activeCount: 0,
      activeMessages: [],
      lastMessageId: null,
      pending: [],
      subscribers: null,
      syncedAt: new Date("2026-08-27T18:00:00Z"),
      ok: true,
      activeState: "live",
      pendingState: "live",
      overallState: "live",
      refresh: vi.fn(),
    });

    const { container } = render(<MemoryRouter><App /></MemoryRouter>);

    // Workspace health belongs where the data is used, not in the topbar.
    expect(container.querySelector(".content-topbar")).toBeInTheDocument();
    expect(container.querySelector(".topbar-system-status")).toBeNull();
  });

  it("shows the SST desk only what it can use and lands it on the Dispatch Log", () => {
    vi.mocked(useAuth).mockReturnValue({
      account: { name: "SST Desk", username: "ocs@sst.test" },
      roles: ["OCC.TripStartVerify"],
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(useLiveStats).mockReturnValue({
      activeCount: 0, activeMessages: [], lastMessageId: null, pending: [], subscribers: null,
      syncedAt: null, ok: false, activeState: "unavailable", pendingState: "unavailable", overallState: "unavailable", refresh: vi.fn(),
    } as never);

    // Scoped to this render: the file does not clean up between tests, so the
    // document also holds the Viewer-role shell from the test above.
    const { container } = render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);

    const nav = container.querySelector("#primary-nav");
    expect(nav).not.toBeNull();
    const links = Array.from(nav!.querySelectorAll("a")).map((a) => a.textContent?.trim());
    expect(links).toContain("Dispatch Log");
    for (const hidden of ["Dashboard", "Overview", "Compose", "Active Service Alerts", "Suggested Alerts", "Service Risk & Quality"]) {
      expect(links).not.toContain(hidden);
    }
    // "/" redirects to the one workspace this role can use.
    expect(container).toHaveTextContent("Dispatch Log workspace");
  });

  it("does not start API-backed shell data while authentication is unavailable", () => {
    render(<MemoryRouter><App /></MemoryRouter>);

    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(useLiveStats).not.toHaveBeenCalled();
  });
});
