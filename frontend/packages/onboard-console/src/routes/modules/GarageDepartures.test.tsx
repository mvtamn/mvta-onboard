import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { GarageDepartures } from "./GarageDepartures.js";

vi.mock("../../config.js", () => ({
  api: {
    getFixedRouteDepartures: vi.fn(),
    getOnDemandDepartures: vi.fn(),
    getKpiTrust: vi.fn().mockResolvedValue({ streams: {} }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Garage Departures", () => {
  it("shows fixed route first and reads on-demand only when that service is chosen", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValue({
      departures: [],
      diagnostics: { configured: true, table_ready: true, record_count: 0, late_count: 0, expired_count: 0, avg_delta_seconds: null },
    });
    vi.mocked(api.getOnDemandDepartures).mockResolvedValue({
      departures: [],
      diagnostics: { configured: false, table_ready: false, record_count: 0, late_count: 0, no_departure_count: 0, avg_delta_seconds: null, variance_seconds: 600 },
    });

    render(<GarageDepartures />);

    expect(screen.getByRole("heading", { name: "Garage Departures" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Fixed route departures summary")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Fixed Route" })).toHaveAttribute("aria-selected", "true");
    // One source per service type: the on-demand feed is not consulted for
    // the fixed-route view, so its not-connected state cannot leak in.
    expect(api.getOnDemandDepartures).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "On-Demand" }));

    expect(await screen.findByLabelText("On-demand departures summary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fixed route departures summary")).not.toBeInTheDocument();
    expect(await screen.findByText("Departure monitoring is not configured")).toBeInTheDocument();
    expect(screen.getByText(/Spare's start-location slot/)).toBeInTheDocument();
  });
});
