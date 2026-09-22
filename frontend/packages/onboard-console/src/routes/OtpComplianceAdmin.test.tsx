import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OtpComplianceAdmin } from "./OtpComplianceAdmin.js";
import { OtpModule } from "./modules/otp/OtpModule.js";

vi.mock("../config.js", () => ({ api: {
  getOtpSettings: vi.fn().mockResolvedValue({ early_late_bias_threshold: 0.25 }),
  updateOtpSettings: vi.fn(),
  getReasonCodes: vi.fn().mockResolvedValue({ reason_codes: [
    { id: "rc1", code: "SIGNAL", label: "Signal timing", applies_to: "stop", sort_order: 1, is_active: true },
  ] }),
  createReasonCode: vi.fn(),
  updateReasonCode: vi.fn(),
  getReducedServiceDays: vi.fn().mockResolvedValue({ service_month: "202609", days: [], evidence: [], affected_day_of_week: [] }),
  declareReducedServiceDay: vi.fn(),
  deleteReducedServiceDay: vi.fn(),
  // The server decides which stops are flagged and how many (ADR 0034); the
  // console renders the answer. `threshold` is the tuner's trial value.
  getOtpMonthly: vi.fn().mockImplementation((_month?: string, threshold?: number) =>
    Promise.resolve({
      flagged: [
        { route_id: 490, route_label: "490", stop_id: 13209, stop_name: "Wash/Coffman SW", day_of_week: "Monday", total: 34, pct_early: 0.324, pct_late: 0.441, pct_ontime: 0.235, pct_missed: 0 },
      ],
      routes: [],
      diagnostics: {
        configured: true, table_ready: true, service_month: "202609", record_count: 2,
        routes_below_target: 0, target: 0.85,
        flagged_threshold: threshold ?? 0.25,
        flagged_count: threshold === undefined ? 7 : 3,
      },
    }),
  ),
  getOtpMonthlyTrend: vi.fn().mockResolvedValue({ trend: [] }),
  getDateExclusions: vi.fn().mockResolvedValue({ exclusions: [] }),
  getStopExclusions: vi.fn().mockResolvedValue({ exclusions: [] }),
  getOtpAuditStream: vi.fn().mockResolvedValue({ entries: [] }),
  runOtpHistoricalBackfill: vi.fn(),
} }));


describe("OTP compliance administration", () => {
  afterEach(cleanup);

  it("hosts the reason codes, threshold tuner, and backfill in the Administration workspace", async () => {
    render(<OtpComplianceAdmin />);

    expect(await screen.findByText("Stop exclusion reason codes")).toBeInTheDocument();
    expect(screen.getByText("Date exclusion reason codes")).toBeInTheDocument();
    expect(screen.getByText("Missed Trips reason codes")).toBeInTheDocument();
    expect(screen.getByText("Threshold tuner")).toBeInTheDocument();
    expect(screen.getByText("Historical data backfill")).toBeInTheDocument();
  });

  // The saved threshold lands after this page mounts, so the slider has to
  // follow it - the built-in fallback is 15%, and the mock saves 25%.
  it("seeds the tuner slider from the saved threshold, not the built-in default", async () => {
    render(<OtpComplianceAdmin />);

    // "Currently applied" renders straight from the fetched threshold, but the
    // slider follows it from an effect, so it is still showing the 15% default
    // in the commit that first paints "Currently applied (25%)". Reading the
    // slider synchronously off the back of that await is a race - it passed
    // only when the effect's re-render happened to flush inside the findBy
    // poll. Await the seeded values themselves; the point of the test is that
    // they arrive at all.
    expect(await screen.findByText("Currently applied (25%)")).toBeInTheDocument();
    expect(await screen.findByText("Preview threshold: 25.0%")).toBeInTheDocument();
    expect(await screen.findByText("At preview threshold (25.0%)")).toBeInTheDocument();
  });

  it("asks the server for the count at a trial threshold instead of working it out here", async () => {
    const { api } = (await import("../config.js")) as unknown as {
      api: { getOtpMonthly: ReturnType<typeof vi.fn> };
    };
    api.getOtpMonthly.mockClear();
    render(<OtpComplianceAdmin />);

    // The count in force comes from a call with no threshold, so the server
    // applies the stored one.
    await screen.findByText("Currently applied (25%)");
    await vi.waitFor(() =>
      expect(api.getOtpMonthly.mock.calls).toContainEqual([expect.any(String)]),
    );
    expect(await screen.findByText("7")).toBeInTheDocument();

    // Moving the slider asks again, with the trial value - it is never
    // re-derived in the browser (ADR 0034).
    fireEvent.change(await screen.findByRole("slider"), { target: { value: "40" } });
    await vi.waitFor(
      () => expect(api.getOtpMonthly.mock.calls).toContainEqual([expect.any(String), 0.4]),
      { timeout: 2000 },
    );
    expect(await screen.findByText("At preview threshold (40.0%)")).toBeInTheDocument();
  });

  it("no longer offers Administration or Threshold Tuner inside the OTP module", async () => {
    render(<OtpModule />);

    expect(await screen.findByRole("button", { name: "Review Queue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Threshold Tuner" })).not.toBeInTheDocument();
  });
});
