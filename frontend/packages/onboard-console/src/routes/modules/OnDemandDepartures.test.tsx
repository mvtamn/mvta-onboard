import { cleanup, render, screen, within } from "@testing-library/react";
import { ApiError, type OnDemandDeparture } from "@mvta/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { OnDemandDepartures } from "./OnDemandDepartures.js";

const departure: OnDemandDeparture = {
  service_date: "20260905",
  duty_id: "duty-1",
  duty_identifier: "D-101",
  driver_id: "drv-1",
  vehicle_id: "veh-7",
  duty_status: "inProgress",
  departure_scheduled: "2026-09-05T12:00:00Z",
  scheduled_source: "slots_startLocation",
  departure_actual: "2026-09-05T12:14:00Z",
  departure_source: "slots_startLocation",
  updated_at: "2026-09-05T12:20:00Z",
  departure_delta_seconds: 840,
  no_departure: false,
};

function diagnostics(overrides: Partial<{
  configured: boolean;
  table_ready: boolean;
  record_count: number;
  late_count: number;
  no_departure_count: number;
  avg_delta_seconds: number | null;
  variance_seconds: number;
}> = {}) {
  return {
    configured: true,
    table_ready: true,
    record_count: 0,
    late_count: 0,
    no_departure_count: 0,
    avg_delta_seconds: null,
    variance_seconds: 600,
    ...overrides,
  };
}

vi.mock("../../config.js", () => ({
  api: {
    getOnDemandDepartures: vi.fn(),
    getKpiTrust: vi.fn().mockResolvedValue({ streams: {} }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function summaryValue(label: string): string {
  const grid = screen.getByLabelText("On-demand departures summary");
  const tile = within(grid).getByText(label).closest(".risk-stat");
  return tile?.querySelector("strong")?.textContent ?? "";
}

describe("On-Demand Departures", () => {
  it("does not report zero late departures when the history table is missing", async () => {
    vi.mocked(api.getOnDemandDepartures).mockResolvedValueOnce({
      departures: [],
      diagnostics: diagnostics({ table_ready: false }),
    });

    render(<OnDemandDepartures />);

    expect(await screen.findByText("Departure monitoring is not connected")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Live data")).not.toBeInTheDocument();
    expect(summaryValue("No departure recorded")).toBe("—");
    expect(summaryValue("Late over 10 min")).toBe("—");
    expect(summaryValue("Duties in window")).toBe("—");
  });

  it("separates a disabled feed from a connected one with no records", async () => {
    vi.mocked(api.getOnDemandDepartures).mockResolvedValueOnce({
      departures: [],
      diagnostics: diagnostics({ configured: false, table_ready: false }),
    });

    render(<OnDemandDepartures />);

    expect(await screen.findByText("Departure monitoring is not configured")).toBeInTheDocument();
    expect(summaryValue("Late over 10 min")).toBe("—");
  });

  it("reports a genuine zero once the feed and its table are both live", async () => {
    vi.mocked(api.getOnDemandDepartures).mockResolvedValueOnce({
      departures: [],
      diagnostics: diagnostics(),
    });

    render(<OnDemandDepartures />);

    expect(await screen.findByText("No departures tracked")).toBeInTheDocument();
    expect(screen.getByText("Live data")).toBeInTheDocument();
    expect(summaryValue("Late over 10 min")).toBe("0");
    expect(summaryValue("No departure recorded")).toBe("0");
  });

  it("renders recorded duties with their source and outcome", async () => {
    vi.mocked(api.getOnDemandDepartures).mockResolvedValueOnce({
      departures: [
        departure,
        {
          ...departure,
          duty_id: "duty-2",
          duty_identifier: null,
          scheduled_source: "duties_startRequested",
          departure_actual: null,
          departure_source: null,
          departure_delta_seconds: null,
          no_departure: true,
        },
      ],
      diagnostics: diagnostics({ record_count: 2, late_count: 1, no_departure_count: 1, avg_delta_seconds: 840 }),
    });

    render(<OnDemandDepartures />);

    expect(await screen.findByText("D-101")).toBeInTheDocument();
    expect(screen.getByText("Start slot")).toBeInTheDocument();
    expect(screen.getByText("Late")).toBeInTheDocument();
    // A duty with no identifier falls back to its id, and one that never
    // departed says so instead of showing a blank delta.
    expect(screen.getByText("duty-2")).toBeInTheDocument();
    expect(screen.getByText("No departure")).toBeInTheDocument();
    expect(screen.getByText(/requested start because Spare has no start-location slot/)).toBeInTheDocument();
    expect(summaryValue("Late over 10 min")).toBe("1");
    expect(summaryValue("No departure recorded")).toBe("1");
    expect(summaryValue("Duties in window")).toBe("2");
  });

  it("does not blame configuration when the service cannot be reached", async () => {
    vi.mocked(api.getOnDemandDepartures).mockRejectedValueOnce(new ApiError(500, "boom"));

    render(<OnDemandDepartures />);

    expect(await screen.findByText("Departure history unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Departure monitoring is not configured")).not.toBeInTheDocument();
    // No diagnostics came back, so the tile cannot name the allowance either.
    expect(summaryValue("Late departures")).toBe("—");
  });
});
