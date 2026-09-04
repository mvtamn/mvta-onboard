import { cleanup, render, screen, within } from "@testing-library/react";
import { ApiError, type FixedRouteDeparture } from "@mvta/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { FixedRouteDepartures } from "./FixedRouteDepartures.js";

const departure: FixedRouteDeparture = {
  service_date: "20260223",
  block: 11801,
  run: 1811,
  checkin_scheduled: "2026-02-23T12:35:00Z",
  checkin_actual: null,
  login_scheduled: "2026-02-23T12:40:00Z",
  login_actual: "2026-02-23T12:52:25Z",
  pullout_scheduled: "2026-02-23T12:50:00Z",
  pullout_actual: "2026-02-23T12:52:55Z",
  pullout_status: "Late Relief",
  operator_name: "HAWTHORNE, PORSCHE -144",
  logon_id: 41901,
  vehicle_label: "1910",
  updated_at: "2026-02-23T13:00:00Z",
  pullout_delta_seconds: 175,
};

function diagnostics(overrides: Partial<{
  configured: boolean;
  table_ready: boolean;
  record_count: number;
  late_count: number;
  expired_count: number;
  avg_delta_seconds: number | null;
}> = {}) {
  return {
    configured: true,
    table_ready: true,
    record_count: 0,
    late_count: 0,
    expired_count: 0,
    avg_delta_seconds: null,
    ...overrides,
  };
}

vi.mock("../../config.js", () => ({
  api: {
    getFixedRouteDepartures: vi.fn(),
    getKpiTrust: vi.fn().mockResolvedValue({ streams: {} }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function summaryValue(label: string): string {
  const grid = screen.getByLabelText("Fixed route departures summary");
  const tile = within(grid).getByText(label).closest(".risk-stat");
  return tile?.querySelector("strong")?.textContent ?? "";
}

describe("Fixed Route Departures", () => {
  it("does not report zero late pullouts when the history table is missing", async () => {
    // The API answers 200 with an empty list whether the table is missing or
    // the window is genuinely quiet. Only table_ready separates them, and a
    // zeroed summary would claim compliance the source never measured.
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValueOnce({
      departures: [],
      diagnostics: diagnostics({ table_ready: false }),
    });

    render(<FixedRouteDepartures />);

    expect(await screen.findByText("Departure monitoring is not connected")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Live data")).not.toBeInTheDocument();
    expect(screen.queryByText("No departures tracked")).not.toBeInTheDocument();

    expect(summaryValue("Expired pullouts")).toBe("—");
    expect(summaryValue("Late pullouts")).toBe("—");
    expect(summaryValue("Tracked in window")).toBe("—");
  });

  it("separates an unconfigured feed from a connected one with no records", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValueOnce({
      departures: [],
      diagnostics: diagnostics({ configured: false, table_ready: false }),
    });

    render(<FixedRouteDepartures />);

    expect(await screen.findByText("Departure monitoring is not configured")).toBeInTheDocument();
    expect(summaryValue("Late pullouts")).toBe("—");
  });

  it("reports a genuine zero once the feed and its table are both live", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValueOnce({
      departures: [],
      diagnostics: diagnostics(),
    });

    render(<FixedRouteDepartures />);

    expect(await screen.findByText("No departures tracked")).toBeInTheDocument();
    expect(screen.getByText("Live data")).toBeInTheDocument();
    // A connected source that ran and found nothing has earned the zero.
    expect(summaryValue("Late pullouts")).toBe("0");
    expect(summaryValue("Expired pullouts")).toBe("0");
  });

  it("renders recorded departures with their counts", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValueOnce({
      departures: [departure],
      diagnostics: diagnostics({ record_count: 1, late_count: 1, avg_delta_seconds: 175 }),
    });

    render(<FixedRouteDepartures />);

    expect(await screen.findByText("HAWTHORNE, PORSCHE -144")).toBeInTheDocument();
    expect(screen.getByText("Late Relief")).toBeInTheDocument();
    expect(summaryValue("Late pullouts")).toBe("1");
    expect(summaryValue("Tracked in window")).toBe("1");
  });

  it("does not blame configuration when the service cannot be reached", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockRejectedValueOnce(new ApiError(500, "boom"));

    render(<FixedRouteDepartures />);

    expect(await screen.findByText("Departure history unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Departure monitoring is not configured")).not.toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(summaryValue("Late pullouts")).toBe("—");
  });
});
