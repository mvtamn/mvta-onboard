import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type FlaggedStop, type ReasonCode, type OtpStopExclusion } from "@mvta/shared";
import { useOtpReview } from "./useOtpReview";

const getStopExclusions = vi.fn();
const putStopExclusion = vi.fn();

vi.mock("../../../config.js", () => ({
  api: {
    getStopExclusions: (...a: unknown[]) => getStopExclusions(...a),
    putStopExclusion: (...a: unknown[]) => putStopExclusion(...a),
  },
}));

const stop = (over: Partial<FlaggedStop> = {}): FlaggedStop => ({
  route_id: 490, route_label: "490", stop_id: 13209, stop_name: "Wash/Coffman SW",
  day_of_week: "Monday", total: 34,
  pct_early: 0.324, pct_ontime: 0.235, pct_late: 0.441, pct_missed: 0, ...over,
});

const decision = (over: Partial<OtpStopExclusion> = {}): OtpStopExclusion => ({
  id: "x1", service_month: "202609", route_id: 490, stop_id: 13209, day_of_week: "Monday",
  status: "approved", reason_code: "SCHED_RECOVERY", reviewed_by: "jane@example.com",
  reviewed_at: "2026-09-10T12:00:00.000Z", ...over,
} as OtpStopExclusion);

const codes: ReasonCode[] = [
  { id: "r1", code: "SCHED_RECOVERY", label: "Recovery point", applies_to: "stop", sort_order: 1, is_active: true, updated_by: null, updated_at: "" },
];

const setup = (over: { serviceMonth?: string | null; flaggedStops?: FlaggedStop[] } = {}) =>
  renderHook(
    (props: { serviceMonth: string | null; flaggedStops: FlaggedStop[] }) =>
      useOtpReview({ ...props, reasonCodes: codes }),
    { initialProps: {
      serviceMonth: "serviceMonth" in over ? over.serviceMonth! : "202609",
      flaggedStops: over.flaggedStops ?? [stop()],
    } },
  );

beforeEach(() => {
  getStopExclusions.mockResolvedValue({ exclusions: [] });
  putStopExclusion.mockResolvedValue({});
});
afterEach(() => {
  getStopExclusions.mockReset();
  putStopExclusion.mockReset();
});

describe("reading a month's decisions", () => {
  it("asks for the month and the one before it, for copy-last-month", async () => {
    setup();
    await waitFor(() => expect(getStopExclusions).toHaveBeenCalledTimes(2));
    expect(getStopExclusions.mock.calls.map((c) => c[0]).sort()).toEqual(["202608", "202609"]);
  });

  it("asks for nothing when no month is resolved yet", async () => {
    const { result } = setup({ serviceMonth: null });
    await waitFor(() => expect(result.current.queueRows).toHaveLength(1));
    expect(getStopExclusions).not.toHaveBeenCalled();
  });

  it("reads a stop's decision back from the month", async () => {
    getStopExclusions.mockResolvedValue({ exclusions: [decision({ status: "rejected" })] });
    const { result } = setup();
    // Pending until the fetch lands, then whatever was recorded.
    expect(result.current.statusOf(stop())).toBe("pending");
    await waitFor(() => expect(result.current.statusOf(stop())).toBe("rejected"));
  });
});

describe("recording a decision", () => {
  it("writes the row, re-reads the month, and says the figure has moved", async () => {
    const { result } = setup();
    await waitFor(() => expect(getStopExclusions).toHaveBeenCalledTimes(2));
    const before = result.current.decisionsVersion;

    await act(async () => { await result.current.resolve(stop(), "approve"); });

    expect(putStopExclusion).toHaveBeenCalledWith(expect.objectContaining({
      service_month: "202609", route_id: 490, stop_id: 13209, day_of_week: "Monday",
      status: "approved", reason_code: "SCHED_RECOVERY",
    }));
    // Approving moves Official Departure OTP, so the caller has to re-read the
    // measurement. It used to update the decision list and leave Route Summary
    // showing the figure from before the approval.
    expect(result.current.decisionsVersion).toBe(before + 1);
    expect(result.current.auditRefreshTick).toBeGreaterThan(0);
  });

  it("does not claim the figure moved when the write failed", async () => {
    const { result } = setup();
    await waitFor(() => expect(getStopExclusions).toHaveBeenCalledTimes(2));
    const before = result.current.decisionsVersion;
    putStopExclusion.mockRejectedValue(new ApiError(500, "Internal server error"));

    await act(async () => { await result.current.resolve(stop(), "reject"); });

    expect(result.current.actionError).toBe("Internal server error");
    expect(result.current.decisionsVersion).toBe(before);
  });

  it("writes nothing at all when no month is resolved", async () => {
    const { result } = setup({ serviceMonth: null });
    await act(async () => { await result.current.resolve(stop(), "approve"); });
    expect(putStopExclusion).not.toHaveBeenCalled();
  });
});

describe("switching month", () => {
  it("clears an error from the month just left", async () => {
    // The bug this extraction exists for: a failed approve on one month used
    // to keep showing as a banner on a different month entirely, because
    // nothing reset it.
    const { result, rerender } = setup();
    await waitFor(() => expect(getStopExclusions).toHaveBeenCalledTimes(2));
    putStopExclusion.mockRejectedValue(new ApiError(409, "Already decided"));
    await act(async () => { await result.current.resolve(stop(), "approve"); });
    expect(result.current.actionError).toBe("Already decided");

    rerender({ serviceMonth: "202608", flaggedStops: [stop()] });

    await waitFor(() => expect(result.current.actionError).toBeNull());
  });

  it("does not show the old month's decisions against the new one", async () => {
    getStopExclusions.mockResolvedValue({ exclusions: [decision()] });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.statusOf(stop())).toBe("approved"));

    getStopExclusions.mockImplementation(() => new Promise(() => {})); // never settles
    rerender({ serviceMonth: "202608", flaggedStops: [stop()] });

    // While the new month is still loading, the stop reads as undecided rather
    // than carrying last month's answer.
    await waitFor(() => expect(result.current.statusOf(stop())).toBe("pending"));
  });

  it("forgets a reason typed against the month just left", async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(getStopExclusions).toHaveBeenCalledTimes(2));
    act(() => { result.current.setReason(stop(), "TYPED"); });
    expect(result.current.reasonOf(stop())).toBe("TYPED");

    rerender({ serviceMonth: "202608", flaggedStops: [stop()] });

    await waitFor(() => expect(result.current.reasonOf(stop())).toBe("SCHED_RECOVERY"));
  });
});

describe("what reason a row shows", () => {
  it("prefers what the reviewer typed, then what was saved, then the first code", async () => {
    getStopExclusions.mockResolvedValue({ exclusions: [decision({ reason_code: "LAYOVER" })] });
    const { result } = setup();
    await waitFor(() => expect(result.current.reasonOf(stop())).toBe("LAYOVER"));

    act(() => { result.current.setReason(stop(), "TYPED"); });
    expect(result.current.reasonOf(stop())).toBe("TYPED");
  });

  it("falls back to the first reason code when nothing is saved or typed", async () => {
    const { result } = setup();
    await waitFor(() => expect(getStopExclusions).toHaveBeenCalledTimes(2));
    expect(result.current.reasonOf(stop())).toBe("SCHED_RECOVERY");
  });
});

describe("copying last month's decisions", () => {
  const other = stop({ route_id: 444, stop_id: 31928 });

  const lastMonthHas = (rows: OtpStopExclusion[]) => {
    getStopExclusions.mockImplementation((month: string) =>
      Promise.resolve({ exclusions: month === "202608" ? rows : [] }),
    );
  };

  it("offers a stop only where last month decided it", async () => {
    lastMonthHas([decision({ service_month: "202608" })]);
    const { result } = setup({ flaggedStops: [stop(), other] });
    await waitFor(() => expect(result.current.previousDecisionFor(stop())).toBeDefined());
    expect(result.current.previousDecisionFor(other)).toBeUndefined();
  });

  it("copies to every pending stop that has one, and no others", async () => {
    lastMonthHas([
      decision({ service_month: "202608" }),
      decision({ id: "x2", service_month: "202608", route_id: 444, stop_id: 31928, status: "rejected" }),
    ]);
    const { result } = setup({ flaggedStops: [stop(), other] });
    await waitFor(() => expect(result.current.previousDecisionFor(other)).toBeDefined());

    await act(async () => { await result.current.copyAllFromPrevious(); });

    expect(putStopExclusion).toHaveBeenCalledTimes(2);
    // One dated row per stop, the same as clicking each individually, so the
    // audit trail keeps its shape.
    expect(putStopExclusion.mock.calls.map((c) => (c[0] as { status: string }).status)).toEqual(["approved", "rejected"]);
  });

  it("stops at the first failure rather than carrying on", async () => {
    lastMonthHas([
      decision({ service_month: "202608" }),
      decision({ id: "x2", service_month: "202608", route_id: 444, stop_id: 31928 }),
    ]);
    const { result } = setup({ flaggedStops: [stop(), other] });
    await waitFor(() => expect(result.current.previousDecisionFor(other)).toBeDefined());
    putStopExclusion.mockRejectedValue(new ApiError(500, "Internal server error"));

    await act(async () => { await result.current.copyAllFromPrevious(); });

    expect(putStopExclusion).toHaveBeenCalledTimes(1);
    expect(result.current.actionError).toBe("Internal server error");
    expect(result.current.copyingAll).toBe(false);
  });
});
