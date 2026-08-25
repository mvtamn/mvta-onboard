import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { OnDemandServiceQuality } from "./OnDemandServiceQuality.js";

const authState = { roles: ["OCC.Admin"] };

vi.mock("../../config.js", () => ({
  api: {
    getOnDemandRisks: vi.fn(),
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
  it("keeps the service standard and monitoring contract visible without live records", async () => {
    vi.mocked(api.getOnDemandRisks).mockRejectedValueOnce(new Error("offline"));

    render(
      <MemoryRouter>
        <OnDemandServiceQuality />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("25 min").length).toBeGreaterThan(0);
    expect(
      await screen.findByText(
        "Current wait-risk records are provided by the vendor-neutral on-demand monitoring contract.",
      ),
    ).toBeInTheDocument();
  });

  it("makes Suggested Alert preparation primary and keeps acknowledgement separate", async () => {
    vi.mocked(api.getOnDemandRisks).mockRejectedValueOnce(new Error("preview mode"));

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "Preview Suggested Alert" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));

    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monitor" })).toBeInTheDocument();
  });

  it("shows the saved standard to a dispatcher without edit controls", async () => {
    vi.mocked(api.getOnDemandRisks).mockRejectedValueOnce(new Error("preview mode"));
    authState.roles = ["OCC.Viewer"];

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);

    expect(await screen.findByText("Saved policy")).toBeInTheDocument();
    expect(screen.getByLabelText("All-zones service standard")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save all-zones default" })).not.toBeInTheDocument();
  });
});
