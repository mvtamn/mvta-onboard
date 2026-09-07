import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixedRouteDeparture } from "@mvta/shared";
import { api } from "../../config.js";
import { FixedRouteDepartures } from "./FixedRouteDepartures.js";

let roles: string[] = ["OCC.Compliance"];
vi.mock("../../auth/AuthContext.js", () => ({ useAuth: () => ({ roles }) }));
vi.mock("../../config.js", () => ({
  api: {
    getFixedRouteDepartures: vi.fn(),
    getKpiTrust: vi.fn().mockResolvedValue({ streams: {} }),
    reviewComplianceOccurrence: vi.fn().mockResolvedValue({ id: "occ-1" }),
  },
}));

// A settled run that never departed: the shape the candidate poll raises an
// occurrence from. "20260905" is left unsettled by settled_before.
function lateRun(overrides: Partial<FixedRouteDeparture> = {}): FixedRouteDeparture {
  return {
    service_date: "20260904", block: 1305, run: 2,
    checkin_scheduled: null, checkin_actual: null, login_scheduled: null, login_actual: null,
    pullout_scheduled: "2026-09-04T12:00:00Z", pullout_actual: null,
    pullout_status: "Missed Pullout", operator_name: null, logon_id: null, vehicle_label: null,
    updated_at: "2026-09-04T13:00:00Z", pullout_delta_seconds: null, outcome: "no_departure",
    occurrence_id: "occ-1", occurrence_review_status: "candidate", occurrence_attribution: "undetermined",
    occurrence_service_month: "202609", occurrence_period_status: "open",
    ...overrides,
  };
}

const diagnostics = {
  configured: true, table_ready: true, record_count: 1, settled_count: 1, late_count: 0,
  no_departure_count: 1, avg_delta_seconds: null, variance_seconds: 600, settled_before: "20260905",
};

describe("settling a garage departure from the departure view", () => {
  beforeEach(() => {
    roles = ["OCC.Compliance"];
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValue({ departures: [lateRun()], diagnostics });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("says whether a judged breach has actually been charged", async () => {
    render(<FixedRouteDepartures />);
    // The outcome column has always said "No departure". Only this column says
    // whether anyone turned that into money.
    expect(await screen.findByText("Awaiting review")).toBeInTheDocument();
  });

  it("charges the contractor without leaving the departure view", async () => {
    const user = userEvent.setup();
    render(<FixedRouteDepartures />);
    await user.click(await screen.findByText("Charge"));
    // The same PATCH the Performance Assessment occurrence queue makes.
    expect(api.reviewComplianceOccurrence).toHaveBeenCalledWith("occ-1", "confirmed", "contractor_error", undefined);
  });

  it("records relief without charging it, and says why", async () => {
    const user = userEvent.setup();
    render(<FixedRouteDepartures />);
    await user.click(await screen.findByText("Excusable"));
    expect(api.reviewComplianceOccurrence).toHaveBeenCalledWith(
      "occ-1", "dismissed", "excusable", expect.stringContaining("excusable"));
  });

  it("offers no decision once the occurrence is settled", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValue({
      departures: [lateRun({ occurrence_review_status: "confirmed", occurrence_attribution: "contractor_error" })],
      diagnostics,
    });
    render(<FixedRouteDepartures />);
    expect(await screen.findByText("Counted in September 2026")).toBeInTheDocument();
    expect(screen.queryByText("Charge")).not.toBeInTheDocument();
  });

  it("will not restate a month already in front of the contractor", async () => {
    // Reopening a finalized period is a manager decision with a logged reason,
    // never a side effect of someone reviewing a departure.
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValue({
      departures: [lateRun({ occurrence_period_status: "issued" })],
      diagnostics,
    });
    render(<FixedRouteDepartures />);
    await screen.findByText("Awaiting review");
    expect(screen.queryByText("Charge")).not.toBeInTheDocument();
  });

  it("shows a read-only reader where it went but offers no buttons", async () => {
    roles = ["OCC.Viewer"];
    render(<FixedRouteDepartures />);
    expect(await screen.findByText("Awaiting review")).toBeInTheDocument();
    expect(screen.queryByText("Charge")).not.toBeInTheDocument();
  });

  it("says nothing was raised for a run the rule did not judge a breach", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValue({
      departures: [lateRun({
        outcome: "departed", pullout_actual: "2026-09-04T12:02:00Z", pullout_delta_seconds: 120,
        occurrence_id: null, occurrence_review_status: null, occurrence_attribution: null,
        occurrence_service_month: null, occurrence_period_status: null,
      })],
      diagnostics,
    });
    render(<FixedRouteDepartures />);
    const row = (await screen.findByText("1305/2")).closest("tr")!;
    expect(within(row).getByText("Not raised")).toBeInTheDocument();
  });
});
