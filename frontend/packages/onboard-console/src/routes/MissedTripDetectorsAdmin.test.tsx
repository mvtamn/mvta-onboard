import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissedTripDetectorsAdmin } from "./MissedTripDetectorsAdmin.js";

const getMissedTripDetectorPromotions = vi.fn();
const recordMissedTripDetectorPromotion = vi.fn();
const getMissedTripDetectorScorecard = vi.fn();

vi.mock("../config.js", () => ({ api: {
  getMissedTripDetectorPromotions: (...args: unknown[]) => getMissedTripDetectorPromotions(...args),
  recordMissedTripDetectorPromotion: (...args: unknown[]) => recordMissedTripDetectorPromotion(...args),
  getMissedTripDetectorScorecard: (...args: unknown[]) => getMissedTripDetectorScorecard(...args),
} }));

const figures = (detector: string, overrides: Record<string, unknown> = {}) => ({
  detector,
  cases: { detected: 20, open: 0, closed_by_evidence: 2, held: 1, awaiting_review: 0, reviewed: 19, legacy: 0, evidence_conflicts: 1 },
  outcomes: { confirmed: 18, timely_service: 1, partial_service_failure: 0, indeterminate: 0 },
  precision: 18 / 19, sample: 19,
  held_reasons: [{ reason: "unknown_data_gap", count: 1 }],
  unknown_rate: 0.05,
  avail: detector === "spare" ? null : { corroborated: 12, partial: 1, confirmed_without_avail: 6 },
  dispatcher: detector === "spare" ? null : { not_observed: 3, observed_on_time: 1, observed_left_late: 0, agreement: 0.75 },
  review: { reviewed: 19, awaiting_review: 0, average_hours_to_review: 4.2 },
  bar: { complete: true, meets_bar: false, sentence: "94.7% precision over 19 case(s) is below 95%." },
  ...overrides,
});

const SCORECARD = {
  from: "20261005", to: "20261018", grouping: "week", precision_bar: 0.95,
  sources: { avail: true, dispatch_log: true },
  periods: [
    {
      start: "20261005", end: "20261011", ended: true,
      detectors: [
        figures("gtfs_cancellation"),
        figures("gtfs_silent_no_show", {
          precision: 0.972, sample: 143,
          bar: { complete: true, meets_bar: true, sentence: "97.2% precision over 143 case(s) meets the bar." },
        }),
        figures("spare"),
      ],
      avail_recall: { whole_misses: 10, caught: 6, linked_not_flagged: 1, awaiting_reviewer: 1, unmatched: 2, recall: 6 / 9, unmatched_rate: 0.2 },
      dispatcher_recall: { verifications: 300, not_observed: 4, caught: 3, missed: 1, recall: 0.75 },
    },
    {
      start: "20261012", end: "20261018", ended: true,
      detectors: [figures("gtfs_cancellation"), figures("gtfs_silent_no_show"), figures("spare")],
      avail_recall: null, dispatcher_recall: null,
    },
  ],
};

const SHADOW = {
  standings: [
    { detector: "gtfs_cancellation", promoted: false, since: null },
    { detector: "gtfs_silent_no_show", promoted: false, since: null },
    { detector: "spare", promoted: false, since: null },
  ],
  history: [],
  ignored: [],
};

describe("Missed-trip detector promotion", () => {
  beforeEach(() => {
    getMissedTripDetectorPromotions.mockReset().mockResolvedValue(SHADOW);
    recordMissedTripDetectorPromotion.mockReset();
    getMissedTripDetectorScorecard.mockReset().mockResolvedValue(SCORECARD);
  });
  afterEach(cleanup);

  it("says every detector is in Shadow detection, and what that means", async () => {
    render(<MissedTripDetectorsAdmin />);
    await waitFor(() => expect(screen.getAllByText("Shadow detection").length).toBe(3));
    expect(screen.getAllByText(/never reach an assessment/)[0]).toBeTruthy();
    expect(screen.getByText(/No detector has been promoted/)).toBeTruthy();
  });

  it("will not send a promotion that has no evidence behind it", async () => {
    render(<MissedTripDetectorsAdmin />);
    await waitFor(() => expect(screen.getAllByText("Shadow detection").length).toBe(3));
    await userEvent.click(screen.getByRole("button", { name: "Record promotion" }));
    expect(recordMissedTripDetectorPromotion).not.toHaveBeenCalled();
    expect(screen.getByText(/Choose the service date/)).toBeTruthy();
    expect(screen.getByText(/precision measured over a complete service week/)).toBeTruthy();
  });

  it("records a promotion with its date and its measurement", async () => {
    recordMissedTripDetectorPromotion.mockResolvedValue({
      detector: "gtfs_silent_no_show", effective_service_date: "20261001", promoted: true,
      reason: "97.2% over the week of 21 September", measured_precision: 0.972, sample_size: 143,
      decided_by: "ops@example.com", decided_at: "2026-09-18T12:00:00.000Z",
    });
    render(<MissedTripDetectorsAdmin />);
    await waitFor(() => expect(screen.getAllByText("Shadow detection").length).toBe(3));

    await userEvent.type(screen.getByLabelText("From service date"), "2026-10-01");
    await userEvent.type(screen.getByLabelText("Measured precision"), "97.2");
    await userEvent.type(screen.getByLabelText("Cases measured"), "143");
    await userEvent.type(screen.getByLabelText("Reason"), "97.2% over the week of 21 September");
    await userEvent.click(screen.getByRole("button", { name: "Record promotion" }));

    await waitFor(() => expect(recordMissedTripDetectorPromotion).toHaveBeenCalledWith({
      detector: "gtfs_silent_no_show", effective_service_date: "20261001", promoted: true,
      reason: "97.2% over the week of 21 September", measured_precision: 0.972, sample_size: 143,
      on_demand_conditions_met: undefined,
    }));
    expect(await screen.findByText(/promoted, from/)).toBeTruthy();
  });

  it("asks the on-demand detector for its extra conditions before promoting it", async () => {
    render(<MissedTripDetectorsAdmin />);
    await waitFor(() => expect(screen.getAllByText("Shadow detection").length).toBe(3));
    await userEvent.selectOptions(screen.getByLabelText("Detector"), "spare");
    await userEvent.type(screen.getByLabelText("From service date"), "2026-10-01");
    await userEvent.type(screen.getByLabelText("Measured precision"), "99");
    await userEvent.type(screen.getByLabelText("Cases measured"), "80");
    await userEvent.type(screen.getByLabelText("Reason"), "two clean weeks");
    await userEvent.click(screen.getByRole("button", { name: "Record promotion" }));
    expect(recordMissedTripDetectorPromotion).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirm the on-demand conditions/)).toBeTruthy();
  });

  it("drops the evidence fields for a demotion", async () => {
    render(<MissedTripDetectorsAdmin />);
    await waitFor(() => expect(screen.getAllByText("Shadow detection").length).toBe(3));
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "demote");
    expect(screen.queryByLabelText("Measured precision")).toBeNull();
    expect(screen.getByRole("button", { name: "Record demotion" })).toBeTruthy();
  });

  it("warns when the history names a detector this build does not know", async () => {
    getMissedTripDetectorPromotions.mockResolvedValue({ ...SHADOW, ignored: ["gtfs_silent_noshow"] });
    render(<MissedTripDetectorsAdmin />);
    expect(await screen.findByText(/promotes nothing/)).toBeTruthy();
  });

  it("shows a refusal the server made", async () => {
    recordMissedTripDetectorPromotion.mockRejectedValue(new Error("This detector already counts on that service date."));
    render(<MissedTripDetectorsAdmin />);
    await waitFor(() => expect(screen.getAllByText("Shadow detection").length).toBe(3));
    await userEvent.type(screen.getByLabelText("From service date"), "2026-10-01");
    await userEvent.type(screen.getByLabelText("Measured precision"), "97");
    await userEvent.type(screen.getByLabelText("Cases measured"), "143");
    await userEvent.type(screen.getByLabelText("Reason"), "measured");
    await userEvent.click(screen.getByRole("button", { name: "Record promotion" }));
    expect(await screen.findByText("This detector already counts on that service date.")).toBeTruthy();
  });
  it("shows the scorecard for the detector chosen, newest week first", async () => {
    render(<MissedTripDetectorsAdmin />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows[1].textContent).toMatch(/94\.7% of 19/);
    expect(rows[2].textContent).toMatch(/97\.2% of 143/);
    expect(rows[2].textContent).toMatch(/66\.7% · 2 unmatched · 1 probable/);
    expect(rows[2].textContent).toMatch(/75\.0% · 1 missed/);
    expect(getMissedTripDetectorScorecard).toHaveBeenCalledWith({ group: "week" });
  });

  it("fills the promotion form from a week that meets the bar", async () => {
    render(<MissedTripDetectorsAdmin />);
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Use this week" }));
    expect((screen.getByLabelText("Measured precision") as HTMLInputElement).value).toBe("97.2");
    expect((screen.getByLabelText("Cases measured") as HTMLInputElement).value).toBe("143");
    expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toMatch(/service week of/);
  });

  it("has no Avail or Dispatch Log comparison for on-demand", async () => {
    render(<MissedTripDetectorsAdmin />);
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "On-demand service failures" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[2].textContent).not.toMatch(/unmatched/);
    expect(screen.queryByRole("button", { name: "Use this week" })).toBeNull();
  });

  it("can be read by service date", async () => {
    render(<MissedTripDetectorsAdmin />);
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Days" }));
    await waitFor(() => expect(getMissedTripDetectorScorecard).toHaveBeenLastCalledWith({ group: "day" }));
  });
});
