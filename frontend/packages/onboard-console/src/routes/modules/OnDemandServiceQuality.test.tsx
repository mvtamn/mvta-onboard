import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@mvta/shared";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { OnDemandServiceQuality } from "./OnDemandServiceQuality.js";

const authState = { roles: ["OCC.Admin"] };

vi.mock("../../config.js", () => ({
  api: {
    getOnDemandRisks: vi.fn(),
    prepareSuggestedAlert: vi.fn(),
    resolveOnDemandIntervention: vi.fn(),
    getKpiTrust: vi.fn().mockResolvedValue({ streams: {} }),
    getOnDemandServiceStandards: vi.fn().mockResolvedValue({ default_minutes: 25, updated_by: null, updated_at: "2026-08-24T00:00:00Z", zones: [] }),
    updateOnDemandServiceStandard: vi.fn(),
    updateOnDemandZoneServiceStandard: vi.fn(),
    removeOnDemandZoneServiceStandard: vi.fn(),
    getOnDemandServiceStandardAudit: vi.fn().mockResolvedValue({ audit: [] }),
  },
}));
vi.mock("../../auth/AuthContext.js", () => ({ useAuth: () => authState }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authState.roles = ["OCC.Admin"];
});

describe("On-Demand Risk investigation workspace", () => {
  it("does not treat an unconnected empty response as Live data or a no-risk result", async () => {
    vi.mocked(api.getOnDemandRisks).mockResolvedValueOnce({
      risks: [],
      diagnostics: {
        state: "not_connected",
        last_authoritative_reconciliation_at: null,
        latest_source_update_at: null,
        active_request_count: null,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    expect(await screen.findByText("On-Demand monitoring is not connected.")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("No on-demand wait risks")).not.toBeInTheDocument();
  });

  it("distinguishes an expired sign-in from an empty monitoring result", async () => {
    vi.mocked(api.getOnDemandRisks).mockRejectedValueOnce(new ApiError(401, "Not authenticated"));

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    expect((await screen.findAllByText("Authentication required")).length).toBeGreaterThan(0);
    expect(screen.queryByText("No on-demand wait risks")).not.toBeInTheDocument();
  });

  it("uses an explicitly marked local-only training scenario", async () => {
    vi.mocked(api.getOnDemandRisks).mockResolvedValueOnce({
      risks: [],
      diagnostics: {
        state: "not_connected",
        last_authoritative_reconciliation_at: null,
        latest_source_update_at: null,
        active_request_count: null,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });
    const user = userEvent.setup();

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);
    await screen.findByText("On-Demand monitoring is not connected.");
    await user.click(screen.getByRole("button", { name: "Training scenario" }));

    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.getByText(/local rehearsal only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Suggested Alert" })).toBeInTheDocument();
    expect(api.prepareSuggestedAlert).not.toHaveBeenCalled();
  });

  it("keeps the applied standard and monitoring contract visible without live records", async () => {
    vi.mocked(api.getOnDemandRisks).mockResolvedValueOnce({
      risks: [],
      diagnostics: {
        state: "no_active_service",
        last_authoritative_reconciliation_at: "2026-08-24T00:00:00Z",
        latest_source_update_at: "2026-08-24T00:00:00Z",
        active_request_count: 0,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });

    render(
      <MemoryRouter>
        <OnDemandServiceQuality />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("25 min").length).toBeGreaterThan(0);
    expect(await screen.findByText("No active on-demand service")).toBeInTheDocument();
  });

  it("makes Suggested Alert preparation primary and keeps acknowledgement separate", async () => {
    vi.mocked(api.getOnDemandRisks).mockRejectedValueOnce(new Error("preview mode"));

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);
    const user = userEvent.setup();

    expect(await screen.findByRole("button", { name: "Preview Suggested Alert" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));

    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monitor" })).toBeInTheDocument();
  });

  it("shows the saved standard to a dispatcher without administration controls", async () => {
    vi.mocked(api.getOnDemandRisks).mockRejectedValueOnce(new Error("preview mode"));
    authState.roles = ["OCC.Viewer"];

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    expect(screen.getAllByText("25 min").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("All-zones service standard")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save all-zones default" })).not.toBeInTheDocument();
  });
});
