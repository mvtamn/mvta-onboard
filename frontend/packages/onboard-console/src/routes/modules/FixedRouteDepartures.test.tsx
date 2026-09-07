import { cleanup, render, screen, within } from "@testing-library/react";
import { ApiError, type FixedRouteDeparture } from "@mvta/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { FixedRouteDepartures } from "./FixedRouteDepartures.js";

// The departure views read roles to decide whether the reviewer may settle an
// occurrence from the row. These tests render the view directly, outside the
// app's provider tree, so the roles come from here.
vi.mock("../../auth/AuthContext.js", () => ({ useAuth: () => ({ roles: ["OCC.Compliance"] }) }));


const departure: FixedRouteDeparture = {
    occurrence_id: null, occurrence_review_status: null, occurrence_attribution: null,
    occurrence_service_month: null, occurrence_period_status: null,

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
  outcome: "departed",
};

function diagnostics(overrides: Partial<{
  configured: boolean;
  table_ready: boolean;
  record_count: number;
  settled_count: number;
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
    settled_count: 0,
    late_count: 0,
    no_departure_count: 0,
    avg_delta_seconds: null,
    variance_seconds: 600,
    settled_before: "20260224",
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

    expect(summaryValue("No departure")).toBe("—");
    expect(summaryValue("Late over 10 min")).toBe("—");
    expect(summaryValue("Runs tracked")).toBe("—");
  });

  it("separates an unconfigured feed from a connected one with no records", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValueOnce({
      departures: [],
      diagnostics: diagnostics({ configured: false, table_ready: false }),
    });

    render(<FixedRouteDepartures />);

    expect(await screen.findByText("Departure monitoring is not configured")).toBeInTheDocument();
    expect(summaryValue("Late over 10 min")).toBe("—");
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
    expect(summaryValue("Late over 10 min")).toBe("0");
    expect(summaryValue("No departure")).toBe("0");
  });

  it("renders recorded departures with their counts", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValueOnce({
      departures: [departure],
      diagnostics: diagnostics({ record_count: 1, settled_count: 1, late_count: 1, avg_delta_seconds: 175 }),
    });

    render(<FixedRouteDepartures />);

    // The operator reads as a name with the badge beside it; Avail's status
    // is shown as emitted, with the judged outcome beside it.
    expect(await screen.findByText("Hawthorne, Porsche")).toBeInTheDocument();
    expect(screen.getByText("#144")).toBeInTheDocument();
    expect(screen.getByText("Late Relief")).toBeInTheDocument();
    expect(screen.getByText("Within allowance")).toBeInTheDocument();
    expect(screen.getByText("Mon, Feb 23, 2026")).toBeInTheDocument();
    expect(summaryValue("Late over 10 min")).toBe("1");
    expect(summaryValue("Runs tracked")).toBe("1");
  });

  it("does not blame configuration when the service cannot be reached", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockRejectedValueOnce(new ApiError(500, "boom"));

    render(<FixedRouteDepartures />);

    expect(await screen.findByText("Departure history unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Departure monitoring is not configured")).not.toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    // With no diagnostics the allowance is unknown, so the label cannot name it.
    expect(summaryValue("Late over allowance")).toBe("—");
  });
});
