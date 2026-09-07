import { cleanup, render, screen, within } from "@testing-library/react";
import { ApiError, type OnDemandDeparture } from "@mvta/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { OnDemandDepartures } from "./OnDemandDepartures.js";

// The departure views read roles to decide whether the reviewer may settle an
// occurrence from the row. These tests render the view directly, outside the
// app's provider tree, so the roles come from here.
vi.mock("../../auth/AuthContext.js", () => ({ useAuth: () => ({ roles: ["OCC.Compliance"] }) }));


const departure: OnDemandDeparture = {
    occurrence_id: null, occurrence_review_status: null, occurrence_attribution: null,
    occurrence_service_month: null, occurrence_period_status: null,

  service_date: "20260904",
  duty_id: "duty-1",
  duty_identifier: "D-101",
  driver_id: "drv-1",
  vehicle_id: "veh-7",
  vehicle_identifier: "1188",
  driver_name: "Hawthorne, Porsche",
  driver_identifier: "144",
  duty_status: "inProgress",
  departure_scheduled: "2026-09-04T12:00:00Z",
  scheduled_source: "slots_startLocation",
  departure_actual: "2026-09-04T12:14:00Z",
  departure_source: "slots_startLocation",
  updated_at: "2026-09-04T12:20:00Z",
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
  settled_before: string;
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
    settled_before: "20260905",
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
          driver_name: null,
          driver_identifier: null,
          vehicle_id: "veh-8",
          vehicle_identifier: null,
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
    expect(await screen.findByText("Fri, Sep 4, 2026")).toBeInTheDocument();
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
    // The driver reads as a name with the Spare identifier beside it and the
    // Spare id on hover, the way the fixed-route view shows a badge.
    expect(screen.getByText("Hawthorne, Porsche")).toHaveAttribute("title", "Spare driver drv-1");
    expect(screen.getByText("#144")).toBeInTheDocument();
    expect(screen.queryByText("drv-1…")).not.toBeInTheDocument();
    expect(screen.getByText("No driver on duty")).toBeInTheDocument();
    // The Spare duty id rides on the row for lookup.
    expect(screen.getByText("D-101").closest("tr")).toHaveAttribute("title", "Spare duty duty-1");
    // The fleet number shows when known, with Spare's id on hover; the id's
    // short reference stands in when it is not.
    expect(screen.getByText("1188")).toHaveAttribute("title", "Spare vehicle veh-7");
    expect(screen.getByText("veh-8…")).toHaveAttribute("title", "veh-8");
    expect(screen.queryByText("veh-7")).not.toBeInTheDocument();
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

describe("On-Demand Departures duty column", () => {
  it("is left out when no duty in view has a Spare identifier, and a driver without a name shows as a reference", async () => {
    vi.mocked(api.getOnDemandDepartures).mockResolvedValueOnce({
      departures: [{ ...departure, duty_identifier: null, driver_name: null, driver_identifier: null }],
      diagnostics: diagnostics({ record_count: 1, judged_count: 1, late_count: 1, avg_delta_seconds: 840 }),
    });

    render(<OnDemandDepartures />);

    expect(await screen.findByText("Fri, Sep 4, 2026")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Duty/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^duty duty-1/)).not.toBeInTheDocument();
    expect(screen.getByText("drv-1…")).toHaveAttribute("title", "drv-1");
    expect(screen.getByText("7:14 AM").closest("tr")).toHaveAttribute("title", "Spare duty duty-1");
  });
});
