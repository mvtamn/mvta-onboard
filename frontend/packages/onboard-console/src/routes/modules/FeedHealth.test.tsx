import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedHealth } from "./FeedHealth.js";

const { getFeedChecks, getKpiTrust } = vi.hoisted(() => ({ getFeedChecks: vi.fn(), getKpiTrust: vi.fn() }));
vi.mock("../../config.js", () => ({ api: { getFeedChecks, getKpiTrust } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FeedHealth", () => {
  it("shows live, empty, and failed feed results after an explicit check", async () => {
    getFeedChecks.mockResolvedValueOnce({
      checked_at: "2026-08-14T22:00:00Z",
      checks: [
        { name: "TripUpdates", configured: true, status: 200, records: 134 },
        { name: "Pullout", configured: true, status: 200, records: 0 },
        { name: "Spare", configured: true, status: 401 },
        { name: "Spare missed-trip Slots ingestion", configured: true, records: 24, freshness: "current", last_success_at: "2026-08-14T21:58:00Z" },
      ],
    });
    getKpiTrust.mockResolvedValueOnce({
      checked_at: "2026-08-14T22:00:00Z",
      streams: {
        fixed_route_delay: {
          state: "current",
          contract_pending: false,
          explanation: "Required feed dependencies are current.",
          dependencies: [],
        },
      },
    });
    render(<FeedHealth />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Check feeds" }));

    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Spare missed-trip Slots ingestion")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("fixed route delay")).toBeInTheDocument();
    expect(getFeedChecks).toHaveBeenCalledOnce();
    expect(getKpiTrust).toHaveBeenCalledOnce();
  });

  it("keeps connection diagnostics available when KPI trust is temporarily unavailable", async () => {
    getFeedChecks.mockResolvedValueOnce({
      checked_at: "2026-08-14T22:00:00Z",
      checks: [{ name: "TripUpdates", configured: true, status: 200, records: 134 }],
    });
    getKpiTrust.mockRejectedValueOnce(new Error("trust unavailable"));
    render(<FeedHealth />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Check feeds" }));

    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "KPI trust" })).not.toBeInTheDocument();
  });
});
