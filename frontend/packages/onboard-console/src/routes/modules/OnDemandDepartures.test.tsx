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
  outcome: "late",
};

function diagnostics(overrides: Partial<{
  configured: boolean;
  table_ready: boolean;
  record_count: number;
  judged_count: number;
  late_count: number;
  no_departure_count: number;
  avg_delta_seconds: number | null;
  variance_seconds: number;
  today_service_date: string;
}> = {}) {
  return {
    configured: true,
    table_ready: true,
    record_count: 0,
    judged_count: 0,
    late_count: 0,
    no_departure_count: 0,
    avg_delta_seconds: null,
    variance_seconds: 600,
    today_service_date: "20260905",
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
          duty_id: "9e0f4b2c-6a8d-4e1f-b3c5-7d9e1f3a5b7c",
          duty_identifier: null,
          driver_id: null,
          scheduled_source: "duties_startRequested",
          departure_actual: null,
          departure_source: null,
          departure_delta_seconds: null,
          no_departure: true,
          outcome: "no_departure",
        },
      ],
      diagnostics: diagnostics({ record_count: 2, judged_count: 2, late_count: 1, no_departure_count: 1, avg_delta_seconds: 840 }),
    });

    render(<OnDemandDepartures />);

    // The day is a band, times are Central with their source underneath.
    expect(await screen.findByText("Sat, Sep 5, 2026")).toBeInTheDocument();
    expect(screen.getByText("D-101")).toBeInTheDocument();
    expect(screen.getAllByText("7:00 AM").length).toBe(2);
    expect(screen.getByText("7:14 AM")).toBeInTheDocument();
    expect(screen.getByText("start slot")).toBeInTheDocument();
    expect(screen.getByText("slot started")).toBeInTheDocument();
    expect(screen.getByText("requested start")).toBeInTheDocument();
    expect(screen.getAllByText("+14 min").length).toBe(2); // the row and the Avg delta card
    expect(screen.getByText("Late")).toBeInTheDocument();
    expect(screen.getAllByText("No departure").length).toBe(2); // the row and the strip legend
    // Spare ids read as short references with the full id on hover; a duty
    // with no identifier says it is showing its id, and a blank says what
    // is missing.
    expect(screen.getByText("duty 9e0f4b2c…")).toHaveAttribute("title", "9e0f4b2c-6a8d-4e1f-b3c5-7d9e1f3a5b7c");
    expect(screen.getByText("drv-1…")).toHaveAttribute("title", "drv-1");
    expect(screen.getByText("No driver on duty")).toBeInTheDocument();
    expect(screen.queryByText("20260905")).not.toBeInTheDocument();
    expect(summaryValue("Late over 10 min")).toBe("1");
    expect(summaryValue("No departure recorded")).toBe("1");
    expect(summaryValue("Duties in window")).toBe("2");
    expect(screen.getByText("50.0% of 2 judged duties")).toBeInTheDocument();
  });

  it("does not blame configuration when the service cannot be reached", async () => {
    vi.mocked(api.getOnDemandDepartures).mockRejectedValueOnce(new ApiError(500, "boom"));

    render(<OnDemandDepartures />);

    expect(await screen.findByText("Departure history unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Departure monitoring is not configured")).not.toBeInTheDocument();
    // No diagnostics came back, so the tile cannot name the allowance either.
    expect(summaryValue("Late over allowance")).toBe("—");
  });
});
