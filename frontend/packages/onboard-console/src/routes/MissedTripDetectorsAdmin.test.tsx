import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissedTripDetectorsAdmin } from "./MissedTripDetectorsAdmin.js";

const getMissedTripDetectorPromotions = vi.fn();
const recordMissedTripDetectorPromotion = vi.fn();

vi.mock("../config.js", () => ({ api: {
  getMissedTripDetectorPromotions: (...args: unknown[]) => getMissedTripDetectorPromotions(...args),
  recordMissedTripDetectorPromotion: (...args: unknown[]) => recordMissedTripDetectorPromotion(...args),
} }));

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
});
