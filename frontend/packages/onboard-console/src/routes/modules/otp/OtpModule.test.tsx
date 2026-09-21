import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlaggedStop } from "@mvta/shared";
import { OtpModule } from "./OtpModule.js";

const stop = (overrides: Partial<FlaggedStop> = {}): FlaggedStop => ({
  route_id: 490, route_label: "490", stop_id: 13209, stop_name: "Wash/Coffman SW",
  day_of_week: "Monday", total: 34,
  pct_early: 0.324, pct_ontime: 0.235, pct_late: 0.441, pct_missed: 0, ...overrides,
});

const flagged: FlaggedStop[] = [
  stop(),
  stop({ route_id: 444, route_label: "444", stop_id: 31928, stop_name: "Burnsville Tran", total: 282, pct_early: 0.415, pct_late: 0.113, pct_ontime: 0.468, pct_missed: 0.004 }),
];

const monthly = (over: { flagged?: FlaggedStop[]; record_count?: number } = {}) => ({
  routes: [],
  flagged: over.flagged ?? flagged,
  measurement: {
    service_month: "202609", target: 0.85, target_source: "catalog",
    raw: { departures: 0, ontime: 0, pct: null },
    excluded: { departures: 0, ontime: 0, pct: null },
    assessable: { departures: 0, ontime: 0, pct: null },
    routes: [], routes_below_target: 0, weather_days_recorded: 0, feed_ready: true,
  },
  diagnostics: {
    configured: true, table_ready: true, service_month: "202609",
    record_count: over.record_count ?? 910, routes_below_target: 0, target: 0.85,
    target_source: "catalog", weather_days_recorded: 0,
    flagged_threshold: 0.15, flagged_count: (over.flagged ?? flagged).length,
  },
});

const getOtpMonthly = vi.fn();

vi.mock("../../../config.js", () => ({ api: {
  getOtpMonthly: (...args: unknown[]) => getOtpMonthly(...args),
  getOtpSettings: vi.fn().mockResolvedValue({ early_late_bias_threshold: 0.15 }),
  getReasonCodes: vi.fn().mockResolvedValue({ reason_codes: [
    { id: "rc1", code: "RECOVERY", label: "Recovery point", applies_to: "stop", sort_order: 1, is_active: true },
  ] }),
  getDateExclusions: vi.fn().mockResolvedValue({ exclusions: [] }),
  getStopExclusions: vi.fn().mockResolvedValue({ exclusions: [] }),
  getOtpAuditStream: vi.fn().mockResolvedValue({ entries: [] }),
  getOtpMonthlyTrend: vi.fn().mockResolvedValue({ trend: [] }),
  putStopExclusion: vi.fn(),
  createDateExclusion: vi.fn(),
  getAssessmentPeriods: vi.fn().mockResolvedValue({ periods: [] }),
  getPeriodAssessments: vi.fn().mockResolvedValue({ assessments: [] }),
} }));

describe("the OTP Review Queue", () => {
  afterEach(() => {
    cleanup();
    getOtpMonthly.mockReset();
  });

  it("renders the Flagged Stops the server sent, in the order it sent them", async () => {
    getOtpMonthly.mockResolvedValue(monthly());
    const { container } = render(<OtpModule />);

    await screen.findByText("Wash/Coffman SW");

    // The server orders by worst lean; the console does not re-sort.
    const titles = [...container.querySelectorAll(".check-row .check-title")].map((n) => n.textContent);
    expect(titles).toEqual(["RT 490Wash/Coffman SW", "RT 444Burnsville Tran"]);
  });

  it("describes a stop from the feed's own fields, with no invented direction", async () => {
    getOtpMonthly.mockResolvedValue(monthly());
    const { container } = render(<OtpModule />);

    await screen.findByText("Wash/Coffman SW");

    // Day of week replaces the placeholder direction the queue used to print
    // as "—" for every live row, and departures replace "trips sampled".
    const desc = container.querySelector(".check-row .check-desc")?.textContent;
    expect(desc).toBe("Stop 13209 \u00b7 Monday \u00b7 34 departures sampled \u00b7 Late-biased");
  });

  it("says the feed is empty rather than showing stops nobody can action", async () => {
    getOtpMonthly.mockResolvedValue(monthly({ flagged: [], record_count: 0 }));
    render(<OtpModule />);

    expect(
      await screen.findByText(/has no rows for this month yet, so there is nothing to review/),
    ).toBeInTheDocument();
    // The eleven invented preview stops are gone: approving one only ever
    // flipped local state, because there was no real row to persist against.
    expect(screen.queryByText("Wash/Coffman SW")).not.toBeInTheDocument();
  });

  it("asks for the month's figures without a threshold, so the server applies the stored one", async () => {
    getOtpMonthly.mockResolvedValue(monthly());
    render(<OtpModule />);

    await screen.findByText("Wash/Coffman SW");
    expect(getOtpMonthly.mock.calls).toContainEqual([expect.any(String)]);
  });
});
