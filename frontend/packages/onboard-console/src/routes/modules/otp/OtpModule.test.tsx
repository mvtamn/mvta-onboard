import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ApiError, type FlaggedStop } from "@mvta/shared";
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

const monthly = (over: { flagged?: FlaggedStop[]; record_count?: number; weatherRecorded?: number; weatherApplied?: number; target?: number } = {}) => ({
  routes: [],
  flagged: over.flagged ?? flagged,
  measurement: {
    service_month: "202609", target: over.target ?? 0.85, target_source: "catalog",
    raw: { departures: 0, ontime: 0, pct: null },
    excluded: { departures: 0, ontime: 0, pct: null },
    assessable: { departures: 0, ontime: 0, pct: null },
    routes: [], routes_below_target: 0,
    weather_days_recorded: over.weatherRecorded ?? 0,
    weather_days_applied: over.weatherApplied ?? 0,
    feed_ready: true,
  },
  diagnostics: {
    configured: true, table_ready: true, service_month: "202609",
    record_count: over.record_count ?? 910, routes_below_target: 0, target: over.target ?? 0.85,
    target_source: "catalog", weather_days_recorded: over.weatherRecorded ?? 0,
    flagged_threshold: 0.15, flagged_count: (over.flagged ?? flagged).length,
  },
});

const getOtpMonthly = vi.fn();
const getDateExclusions = vi.fn();
const getOtpMonthlyTrend = vi.fn();
const approveDateExclusion = vi.fn();
const withdrawDateExclusion = vi.fn();

const dateExclusion = (over: Record<string, unknown> = {}) => ({
  id: "de-1", scope: "Agency", route_id: null, service_date: "20260907",
  reason_code: "WEATHER_SNOW", notes: "Snow emergency", status: "Proposed",
  notified: false, notified_at: null, acknowledged: false,
  created_by: "occ@example.com", created_at: "2026-09-08T12:00:00Z",
  approved_by: null, approved_at: null, excluded_departures: 0, ...over,
});

vi.mock("../../../config.js", () => ({ api: {
  getOtpMonthly: (...args: unknown[]) => getOtpMonthly(...args),
  getOtpSettings: vi.fn().mockResolvedValue({ early_late_bias_threshold: 0.15 }),
  getReasonCodes: vi.fn().mockResolvedValue({ reason_codes: [
    { id: "rc1", code: "RECOVERY", label: "Recovery point", applies_to: "stop", sort_order: 1, is_active: true },
  ] }),
  getDateExclusions: (...args: unknown[]) => getDateExclusions(...args),
  approveDateExclusion: (...args: unknown[]) => approveDateExclusion(...args),
  withdrawDateExclusion: (...args: unknown[]) => withdrawDateExclusion(...args),
  getStopExclusions: vi.fn().mockResolvedValue({ exclusions: [] }),
  getOtpAuditStream: vi.fn().mockResolvedValue({ entries: [] }),
  getOtpMonthlyTrend: (...args: unknown[]) => getOtpMonthlyTrend(...args),
  putStopExclusion: vi.fn(),
  createDateExclusion: vi.fn(),
  getAssessmentPeriods: vi.fn().mockResolvedValue({ periods: [] }),
  getPeriodAssessments: vi.fn().mockResolvedValue({ assessments: [] }),
} }));

getOtpMonthlyTrend.mockResolvedValue({ trend: [] });

describe("the OTP Review Queue", () => {
  afterEach(() => {
    cleanup();
    getOtpMonthly.mockReset();
    getDateExclusions.mockReset();
    approveDateExclusion.mockReset();
    withdrawDateExclusion.mockReset();
    getDateExclusions.mockResolvedValue({ exclusions: [] });
  });

  beforeEach(() => {
    getDateExclusions.mockResolvedValue({ exclusions: [] });
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


describe("approving a weather day", () => {
  afterEach(() => {
    cleanup();
    getOtpMonthly.mockReset();
    getDateExclusions.mockReset();
    approveDateExclusion.mockReset();
  });

  async function openWeatherPage() {
    const view = render(<OtpModule />);
    await screen.findByRole("button", { name: "Weather Exclusions" });
    await userEvent.click(screen.getByRole("button", { name: "Weather Exclusions" }));
    return view;
  }

  it("offers Approve on a recorded day, and says what approving took out", async () => {
    getOtpMonthly.mockResolvedValue(monthly());
    getDateExclusions.mockResolvedValue({ exclusions: [dateExclusion()] });
    approveDateExclusion.mockResolvedValue({
      exclusion: dateExclusion({ status: "Approved" }),
      snapshot: { service_month: "202609", day_of_week: "Mon", stops: 86, departures: 1043 },
    });

    await openWeatherPage();
    const approve = await screen.findByRole("button", { name: "Approve" });
    await userEvent.click(approve);

    // The reviewer is told what left the figure, not just that it worked.
    expect(await screen.findByText(/Removed 1,043 departures across 86 stops \(Mon\)/)).toBeTruthy();
    expect(approveDateExclusion).toHaveBeenCalledWith("de-1");
  });

  it("re-reads the month, because approving moves the official figure", async () => {
    getOtpMonthly.mockResolvedValue(monthly());
    getDateExclusions.mockResolvedValue({ exclusions: [dateExclusion()] });
    approveDateExclusion.mockResolvedValue({
      exclusion: dateExclusion({ status: "Approved" }),
      snapshot: { service_month: "202609", day_of_week: "Mon", stops: 1, departures: 30 },
    });

    await openWeatherPage();
    await screen.findByRole("button", { name: "Approve" });
    const before = getOtpMonthly.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/Removed 30 departures/);

    expect(getOtpMonthly.mock.calls.length).toBeGreaterThan(before);
  });

  it("shows the server's own reason when a date cannot be evidenced, and leaves it unapproved", async () => {
    getOtpMonthly.mockResolvedValue(monthly());
    getDateExclusions.mockResolvedValue({ exclusions: [dateExclusion()] });
    approveDateExclusion.mockRejectedValue(
      new ApiError(422, "The daily OTP feed holds no departures for 20260907, so there is nothing to subtract."),
    );

    await openWeatherPage();
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));

    // Not "could not approve": the reviewer needs to know which of the three
    // things was missing to know what to do next.
    expect(await screen.findByRole("alert")).toHaveTextContent(/no departures for 20260907/);
    // Still offered, because nothing was approved.
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  // An approved date subtracts departures from the official figure (ADR 0038),
  // and until now nothing could undo that: list, create and approve were the
  // only operations, so a date approved in error permanently inflated the
  // month and the only way back was a hand edit against the database.
  it("offers Withdraw on an approved day, and asks why before acting", async () => {
    getOtpMonthly.mockResolvedValue(monthly());
    getDateExclusions.mockResolvedValue({ exclusions: [dateExclusion({
      status: "Approved", approved_by: "rob@example.com", approved_at: "2026-09-22T17:00:00Z",
    })] });
    withdrawDateExclusion.mockResolvedValue({ exclusion: dateExclusion({ status: "Withdrawn" }) });

    await openWeatherPage();
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    // One click does not move a published figure.
    expect(withdrawDateExclusion).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Confirm withdrawal" });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Reason for withdrawing/), "Approved against the wrong route scope");
    await userEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    expect(withdrawDateExclusion).toHaveBeenCalledWith("de-1", "Approved against the wrong route scope");
  });

  it("re-reads the month, because withdrawing gives the departures back", async () => {
    getOtpMonthly.mockResolvedValue(monthly());
    getDateExclusions.mockResolvedValue({ exclusions: [dateExclusion({ status: "Approved", approved_by: "rob@example.com" })] });
    withdrawDateExclusion.mockResolvedValue({ exclusion: dateExclusion({ status: "Withdrawn" }) });

    await openWeatherPage();
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    await userEvent.type(screen.getByLabelText(/Reason for withdrawing/), "Not a weather day");
    const before = getOtpMonthly.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findByText(/no longer subtracts/);

    expect(getOtpMonthly.mock.calls.length).toBeGreaterThan(before);
  });

  it("shows a withdrawn day as withdrawn, with who and why, and does not offer it again", async () => {
    // The row and its frozen snapshot are kept deliberately: a dispute is
    // about what was taken out and who decided it, so this is not a delete.
    getOtpMonthly.mockResolvedValue(monthly());
    getDateExclusions.mockResolvedValue({ exclusions: [dateExclusion({
      status: "Withdrawn", approved_by: "rob@example.com",
      withdrawn_by: "maurice@example.com", withdrawn_at: "2026-10-08T15:00:00Z",
      withdrawal_reason: "Approved against the wrong route scope",
    })] });

    await openWeatherPage();
    expect(await screen.findByText("Withdrawn")).toBeTruthy();
    expect(screen.getByText(/maurice@example.com/)).toBeTruthy();
    expect(screen.getByText("Approved against the wrong route scope")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("does not offer Approve on a day already approved, and shows what it removed", async () => {
    getOtpMonthly.mockResolvedValue(monthly());
    getDateExclusions.mockResolvedValue({ exclusions: [dateExclusion({
      status: "Approved", approved_by: "rob@example.com", approved_at: "2026-09-22T17:00:00Z",
      excluded_departures: 1043,
    })] });

    await openWeatherPage();
    await screen.findByText("rob@example.com", { exact: false });

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("1,043")).toBeTruthy();
  });
});

describe("which month's weather days are shown", () => {
  beforeEach(() => {
    getOtpMonthly.mockResolvedValue(monthly());
    getDateExclusions.mockResolvedValue({ exclusions: [] });
  });
  afterEach(() => {
    cleanup();
    getOtpMonthly.mockReset();
    getDateExclusions.mockReset();
  });

  it("asks for the month being viewed, not for every date ever recorded", async () => {
    render(<OtpModule />);
    await screen.findByText("Wash/Coffman SW");
    // It used to be fetched once with no month, so the Weather page listed
    // dates from months nobody was looking at and the Dashboard counted all
    // of them beside a sentence that counted one month's.
    await vi.waitFor(() =>
      expect(getDateExclusions.mock.calls).toContainEqual([expect.stringMatching(/^\d{6}$/)]),
    );
    expect(getDateExclusions.mock.calls.every((c) => c.length === 1)).toBe(true);
  });

  it("counts the month on the Dashboard card, the same as the sentence beside it", async () => {
    getOtpMonthly.mockResolvedValue(monthly({ weatherRecorded: 2, weatherApplied: 1 }));
    const { container } = render(<OtpModule />);
    await screen.findByText("Wash/Coffman SW");
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    const card = [...container.querySelectorAll(".stat-card")]
      .find((c) => c.textContent?.includes("Weather exclusions"));
    expect(card?.textContent).toContain("2");
    // "Recorded, not applied" stopped being true at ADR 0038: an approved
    // date subtracts the departures frozen when it was approved.
    expect(card?.textContent).toContain("1 subtracting");
    expect(card?.textContent).not.toContain("not applied");
  });
});

describe("the trend chart and the card beside it", () => {
  const trend = [
    { service_month: "202607", pct_ontime: 0.88, total: 100, ontime: 88 },
    { service_month: "202608", pct_ontime: 0.84, total: 100, ontime: 84 },
  ];
  afterEach(() => {
    cleanup();
    getOtpMonthly.mockReset();
    getDateExclusions.mockReset();
  });

  it("judges a month against the contract target, not a hardcoded 85", async () => {
    // The card read diagnostics.target while the chart judged against a
    // literal 85. At a target of 90 both of these months are below it; the
    // old chart would have coloured the 88 as meeting while the card counted
    // it as below, and neither would have looked wrong.
    getOtpMonthly.mockResolvedValue(monthly({ target: 0.9 }));
    getDateExclusions.mockResolvedValue({ exclusions: [] });
    getOtpMonthlyTrend.mockResolvedValue({ trend });
    const { container } = render(<OtpModule />);
    await screen.findByText("Wash/Coffman SW");
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));

    await vi.waitFor(() => expect(container.querySelectorAll(".otp-trend-bar").length).toBe(2));
    const bars = [...container.querySelectorAll(".otp-trend-bar")];
    expect(bars.every((b) => b.classList.contains("below"))).toBe(true);
    expect(screen.getByText("Routes below 90%")).toBeInTheDocument();
  });

  it("says which target the bars are judged against", async () => {
    getOtpMonthly.mockResolvedValue(monthly({ target: 0.9 }));
    getDateExclusions.mockResolvedValue({ exclusions: [] });
    getOtpMonthlyTrend.mockResolvedValue({ trend });
    render(<OtpModule />);
    await screen.findByText("Wash/Coffman SW");
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(await screen.findByText(/target of 90%/)).toBeInTheDocument();
  });

  it("prints a target that does not divide cleanly without its floating-point tail", async () => {
    // 0.829 * 100 is 82.89999999999999.
    getOtpMonthly.mockResolvedValue(monthly({ target: 0.829 }));
    getDateExclusions.mockResolvedValue({ exclusions: [] });
    getOtpMonthlyTrend.mockResolvedValue({ trend });
    render(<OtpModule />);
    await screen.findByText("Wash/Coffman SW");
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(screen.getByText("Routes below 82.9%")).toBeInTheDocument();
  });
});
