import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ServiceOperations } from "./ServiceOperations.js";
import { ServiceOperationsOverview } from "./ServiceOperationsOverview.js";
import { ServiceRiskQuality } from "./ServiceRiskQuality.js";
import type { LiveStats } from "../hooks/useLiveStats.js";

const authState = { roles: ["OCC.Admin"], account: { name: "Test User", username: "test@mvta.com" }, signIn: vi.fn(), signOut: vi.fn() };

vi.mock("../auth/AuthContext.js", () => ({ useAuth: () => authState }));
vi.mock("../config.js", () => ({
  api: {
    getTripDelays: vi.fn().mockResolvedValue({ delays: [], diagnostics: { state: "current" } }),
    getOnDemandRisks: vi.fn().mockResolvedValue({ risks: [] }),
  },
}));
vi.mock("./modules/FixedRouteServiceRisk.js", () => ({ FixedRouteServiceRisk: () => <p>Fixed Route view</p> }));
vi.mock("./modules/OnDemandServiceQuality.js", () => ({ OnDemandServiceQuality: () => <p>On-Demand view</p> }));

function stats(overrides: Partial<LiveStats> = {}): LiveStats {
  return {
    activeCount: 2,
    lastMessageId: "msg-1",
    pending: [],
    subscribers: null,
    syncedAt: new Date("2026-08-12T12:00:00Z"),
    ok: true,
    activeState: "live",
    pendingState: "live",
    overallState: "live",
    refresh: vi.fn(),
    ...overrides,
  };
}

function renderShell(initialEntry = "/service-operations") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/service-operations/*" element={<ServiceOperations />}>
          <Route index element={<ServiceOperationsOverview stats={stats()} />} />
          <Route path="compose" element={<p>Compose destination</p>} />
          <Route path="risk" element={<p>Risk destination</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.roles = ["OCC.Admin"];
});
afterEach(() => cleanup());

describe("Service Operations", () => {
  it("shows the communications workspace and the agreed workflows", () => {
    renderShell();

    expect(screen.getByRole("heading", { name: "Service Operations" })).toBeInTheDocument();
    expect(screen.getByText("Communications workspace")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Active Service Alerts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Service Risk & Quality" })).toBeInTheDocument();
  });

  it("keeps the Compose service alert action available from the overview", async () => {
    renderShell();

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Compose service alert" }));
    expect(screen.getByText("Compose destination")).toBeInTheDocument();
  });

  it("shows Service Risk & Quality to dispatch viewers", () => {
    authState.roles = ["OCC.Viewer"];
    renderShell();

    expect(screen.getByRole("link", { name: "Service Risk & Quality" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dispatch Log" })).toBeInTheDocument();
  });

  it("shows the SST desk role only the Dispatch Log", () => {
    authState.roles = ["OCC.TripStartVerify"];
    renderShell();

    expect(screen.getByRole("link", { name: "Dispatch Log" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Service Risk & Quality" })).not.toBeInTheDocument();
  });

  it("shows the Dispatch Log, but not Service Risk, to a Compliance reader", () => {
    authState.roles = ["OCC.Compliance"];
    renderShell();

    expect(screen.getByRole("link", { name: "Dispatch Log" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Service Risk & Quality" })).not.toBeInTheDocument();
  });

  it("switches between Fixed Route and On-Demand risk views", async () => {
    render(<ServiceRiskQuality />);

    expect(screen.getByRole("tabpanel", { name: "Fixed Route service risk" })).toHaveTextContent("Fixed Route view");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "On-Demand" }));
    expect(screen.getByRole("tabpanel", { name: "On-Demand service quality" })).toHaveTextContent("On-Demand view");
  });

  it("labels the workspace as communications and uses one compose action", () => {
    renderShell();

    expect(screen.getByText("Communications workspace")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Compose service alert" })).toHaveLength(1);
  });
});
