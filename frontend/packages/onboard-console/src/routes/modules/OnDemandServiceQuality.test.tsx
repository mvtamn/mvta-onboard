import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type OnDemandRiskRecord } from "@mvta/shared";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { OnDemandServiceQuality } from "./OnDemandServiceQuality.js";

const authState = { roles: ["OCC.Admin"] };

const liveRisk: OnDemandRiskRecord = {
  request_id: "req-1",
  external_request_id: null,
  zone_id: "zone-1",
  wait_started_at: "2026-08-24T00:00:00Z",
  predicted_pickup_at: "2026-08-24T00:40:00Z",
  current_wait_minutes: 30,
  predicted_wait_minutes: 40,
  assigned_vehicle_id: null,
  stops_ahead: null,
  accessible_vehicle_required: false,
  eligible_vehicles_in_zone: 1,
  nearest_vehicle_context: null,
  trend: "worsening",
  prediction_confidence: "high",
  prediction_reasons: [],
  source_updated_at: "2026-08-24T00:29:00Z",
  last_polled_at: "2026-08-24T00:30:00Z",
  suggested_alert_id: null,
  intervention_status: null,
  service_standard_minutes: 25,
  monitor_state: "active",
  zone_resolution: "assigned",
};

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
        monitored_request_count: null,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    expect(await screen.findByText("On-Demand monitoring is not connected.")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("No on-demand wait risks")).not.toBeInTheDocument();
  });

  it("withholds the summary counts rather than reporting zero risks from an unconnected monitor", async () => {
    vi.mocked(api.getOnDemandRisks).mockResolvedValueOnce({
      risks: [],
      diagnostics: {
        state: "not_connected",
        last_authoritative_reconciliation_at: null,
        latest_source_update_at: null,
        active_request_count: null,
        monitored_request_count: null,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    const summary = await screen.findByLabelText("On-demand service quality summary");
    expect(within(summary).getAllByText("—")).toHaveLength(4);
    expect(within(summary).queryByText("0")).not.toBeInTheDocument();
    expect(within(summary).queryByText("0 min")).not.toBeInTheDocument();
  });

  it("reports zero over standard when a successful reconciliation found no active service", async () => {
    vi.mocked(api.getOnDemandRisks).mockResolvedValueOnce({
      risks: [],
      diagnostics: {
        state: "no_active_service",
        last_authoritative_reconciliation_at: "2026-08-24T00:30:00Z",
        latest_source_update_at: "2026-08-24T00:29:00Z",
        active_request_count: 0,
        monitored_request_count: 0,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    const summary = await screen.findByLabelText("On-demand service quality summary");
    expect(within(summary).queryByText("—")).not.toBeInTheDocument();
    expect(within(summary).getAllByText("0")).toHaveLength(3);
    expect(within(summary).getByText("0 min")).toBeInTheDocument();
  });

  // No active service is the monitor answering with nothing to watch, not the
  // monitor failing. It fell through to the red unavailable banner, which on
  // dev meant every night outside service hours read as an outage.
  it("shows no active service as a healthy feed, not a failure", async () => {
    vi.mocked(api.getOnDemandRisks).mockResolvedValueOnce({
      risks: [],
      diagnostics: {
        state: "no_active_service",
        last_authoritative_reconciliation_at: "2026-08-24T00:30:00Z",
        latest_source_update_at: "2026-08-24T00:29:00Z",
        active_request_count: 0,
        monitored_request_count: 0,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });

    const { container } = render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    await screen.findByLabelText("On-demand service quality summary");
    const banner = container.querySelector(".live-banner");
    expect(banner?.className).toContain("tone-muted");
    expect(banner?.querySelector(".live-signal")?.className).toContain("is-live");
    expect(banner?.querySelector(".live-signal-slash")).toBeNull();
    // Quiet: nothing landed for the page to own, so no sweep.
    expect(banner?.querySelector(".live-banner-wire")).toBeNull();
  });

  it("still shows a monitor that is not connected as unavailable", async () => {
    vi.mocked(api.getOnDemandRisks).mockResolvedValueOnce({
      risks: [],
      diagnostics: {
        state: "not_connected",
        last_authoritative_reconciliation_at: null,
        latest_source_update_at: null,
        active_request_count: null,
        monitored_request_count: null,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });

    const { container } = render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    await screen.findByText("On-Demand monitoring is not connected.");
    const banner = container.querySelector(".live-banner");
    expect(banner?.className).toContain("tone-danger");
    expect(banner?.querySelector(".live-signal-slash")).not.toBeNull();
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
        monitored_request_count: null,
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
        monitored_request_count: 0,
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

  it("prepares an update from a current-but-empty stream without asking for a stale-data reason", async () => {
    vi.mocked(api.getOnDemandRisks).mockResolvedValue({
      risks: [liveRisk],
      diagnostics: {
        state: "current",
        last_authoritative_reconciliation_at: "2026-08-24T00:30:00Z",
        latest_source_update_at: "2026-08-24T00:29:00Z",
        active_request_count: 1,
        monitored_request_count: 1,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });
    // The prepare endpoint rejects an acknowledgement recorded against a
    // successful empty run, so the workspace must not collect one here.
    vi.mocked(api.getKpiTrust).mockResolvedValue({
      checked_at: "2026-08-24T00:30:00Z",
      streams: { on_demand: { state: "current_but_empty", contract_pending: false, explanation: "", dependencies: [] } },
    });
    vi.mocked(api.prepareSuggestedAlert).mockResolvedValue({ alert_id: "alert-1", status: "pending", created: true });
    const promptSpy = vi.spyOn(window, "prompt");
    const user = userEvent.setup();

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Prepare Suggested Alert" }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(vi.mocked(api.prepareSuggestedAlert).mock.calls[0][0]).not.toHaveProperty("stale_data_acknowledgement_reason");
  });

  it("says what population the exception list was drawn from", async () => {
    vi.mocked(api.getOnDemandRisks).mockResolvedValueOnce({
      risks: [liveRisk],
      diagnostics: {
        state: "current",
        last_authoritative_reconciliation_at: "2026-08-24T00:30:00Z",
        latest_source_update_at: "2026-08-24T00:29:00Z",
        active_request_count: 40,
        monitored_request_count: 40,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    // One exception out of forty monitored requests reads very differently
    // from "1 trip", which is what a filtered list said before.
    expect(await screen.findByText("1 of 40 monitored")).toBeInTheDocument();
    expect(screen.queryByText("1 trips")).not.toBeInTheDocument();
  });

  it("does not compare against a monitored population in a training scenario", async () => {
    vi.mocked(api.getOnDemandRisks).mockRejectedValueOnce(new ApiError(500, "unavailable"));

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);
    await screen.findByText(/Preview mode/);

    // Preview scenarios are wholly at-risk by construction, so there is no
    // wider population to be a subset of.
    expect(screen.getByText(/trips$/)).toBeInTheDocument();
    expect(screen.queryByText(/of \d+ monitored/)).not.toBeInTheDocument();
  });

  it("keeps an observed overdue request distinct from a projected Watch", async () => {
    // Both are below the 25-minute standard, and the forecast alone would
    // qualify as a Watch; the passed Pickup commitment is the observed fact.
    vi.mocked(api.getOnDemandRisks).mockResolvedValue({
      risks: [
        { ...liveRisk, request_id: "req-overdue", current_wait_minutes: 10, predicted_wait_minutes: 22 },
        { ...liveRisk, request_id: "req-projected", current_wait_minutes: 0, predicted_wait_minutes: 22 },
      ],
      diagnostics: {
        state: "current",
        last_authoritative_reconciliation_at: "2026-08-24T00:30:00Z",
        latest_source_update_at: "2026-08-24T00:29:00Z",
        active_request_count: 2,
        monitored_request_count: 2,
        reconciliation_interval_minutes: 60,
        degraded_after_minutes: 90,
      },
    });

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    const overdue = await screen.findByLabelText("Connect request req-overdue wait-time detail");
    expect(within(overdue).getByText("Overdue")).toBeInTheDocument();
    expect(screen.getAllByText("Watch")).toHaveLength(1);
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
