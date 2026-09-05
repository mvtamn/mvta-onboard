import { cleanup, render, screen } from "@testing-library/react";
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
  getOtpMonthly: vi.fn().mockResolvedValue({
    stops: [
      { route_id: 490, route_label: "490", stop_id: 13209, stop_name: "Wash/Coffman SW", day_of_week: "Mon", total: 34, ontime: 8, pct_early: 0.324, pct_late: 0.441, pct_ontime: 0.235, pct_missed: 0 },
      { route_id: 444, route_label: "444", stop_id: 31928, stop_name: "Burnsville Tran", day_of_week: "Mon", total: 282, ontime: 132, pct_early: 0.08, pct_late: 0.04, pct_ontime: 0.88, pct_missed: 0 },
    ],
    routes: [],
    diagnostics: { configured: true, table_ready: true, service_month: "202609", record_count: 2, routes_below_target: 0, target: 0.85 },
  }),
  getOtpMonthlyTrend: vi.fn().mockResolvedValue({ trend: [] }),
  getDateExclusions: vi.fn().mockResolvedValue({ exclusions: [] }),
  getStopExclusions: vi.fn().mockResolvedValue({ exclusions: [] }),
  getOtpAuditStream: vi.fn().mockResolvedValue({ entries: [] }),
  runOtpHistoricalBackfill: vi.fn(),
} }));

vi.mock("./modules/KpiTrustSummary.js", () => ({ KpiTrustSummary: () => null }));

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

    expect(await screen.findByText("Currently applied (25%)")).toBeInTheDocument();
    expect(screen.getByText("Preview threshold: 25.0%")).toBeInTheDocument();
    // Only the 44.1%-late stop clears a 25% early/late share.
    expect(screen.getByText("At preview threshold (25.0%)")).toBeInTheDocument();
  });

  it("no longer offers Administration or Threshold Tuner inside the OTP module", async () => {
    render(<OtpModule />);

    expect(await screen.findByRole("button", { name: "Review Queue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Threshold Tuner" })).not.toBeInTheDocument();
  });
});
