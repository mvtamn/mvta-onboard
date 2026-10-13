import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FlaggedStop, ReasonCode } from "@mvta/shared";
// NOT @mvta/shared's StopExclusionStatus: that one is what the database
// stores, "approved" | "rejected". The queue's own adds "pending", which is a
// stop nobody has decided yet rather than a row with a status.
import type { StopExclusionStatus } from "./otpData.js";
import { ReviewQueuePage } from "./OtpReviewQueue.js";
import type { QueueRow } from "./otpFigures.js";

vi.mock("../../../config.js", () => ({ api: { getOtpAuditStream: vi.fn().mockResolvedValue({ entries: [] }) } }));

const stop: FlaggedStop = {
  route_id: 444, route_label: "444", stop_id: 51234, stop_name: "Apple Valley Transit Station",
  day_of_week: "Mon", total: 120, pct_early: 0.22, pct_ontime: 0.7, pct_late: 0.05, pct_missed: 0.03,
};
const row: QueueRow = {
  key: "444-51234-Mon", routeLabel: "444", stopName: "Apple Valley Transit Station", stopId: 51234,
  dayOfWeek: "Mon", sampled: 120, earlyPct: 0.22, ontimePct: 0.7, latePct: 0.05, missedPct: 0.03, biasLabel: "Early-biased",
};
const reasonCodes: ReasonCode[] = [
  { id: "rc1", code: "RECOVERY", label: "Recovery point", applies_to: "stop", sort_order: 1, is_active: true, updated_by: null, updated_at: "2026-09-01T00:00:00Z" },
  { id: "rc2", code: "LAYOVER", label: "Layover", applies_to: "stop", sort_order: 2, is_active: true, updated_by: null, updated_at: "2026-09-01T00:00:00Z" },
];

const onResolve = vi.fn();
function renderQueue(status: StopExclusionStatus) {
  return render(
    <ReviewQueuePage
      flaggedStops={[stop]}
      queueRows={[row]}
      statusOf={() => status}
      reasonOf={() => "RECOVERY"}
      reasonCodes={reasonCodes}
      onResolve={onResolve}
      onReason={vi.fn()}
      serviceMonth="202609"
      auditRefreshTick={0}
      previousDecisionFor={() => undefined}
      onCopy={vi.fn()}
      onCopyAll={vi.fn()}
      copyingAll={false}
    />,
  );
}

/** Decided rows are hidden under the default "pending" filter. */
async function showResolved() {
  // Route filter first, then status; neither carries a label today.
  await userEvent.selectOptions(screen.getAllByRole("combobox")[1]!, "resolved");
}

beforeEach(() => { onResolve.mockReset(); onResolve.mockResolvedValue(true); });
afterEach(() => cleanup());

describe("changing a decision that is already made", () => {
  // The API always allowed this - PUT /otp-stop-exclusions upserts in place -
  // but a decided row rendered as static text, so a reviewer who excluded the
  // wrong stop had no way back through the console.
  it("offers Change decision on an excluded stop, and re-decides it", async () => {
    renderQueue("approved");
    await showResolved();
    expect(screen.getByText(/Excluded — Recovery point/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Change the decision/ }));
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(onResolve).toHaveBeenCalledWith(stop, "reject");
  });

  it("offers it on a kept stop too, so an exclusion can be put back", async () => {
    renderQueue("rejected");
    await showResolved();
    expect(screen.getByText("Kept in OTP calc")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Change the decision/ }));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onResolve).toHaveBeenCalledWith(stop, "approve");
  });

  it("closes the row again on Cancel without deciding anything", async () => {
    renderQueue("approved");
    await showResolved();
    await userEvent.click(screen.getByRole("button", { name: /Change the decision/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByText(/Excluded — Recovery point/)).toBeInTheDocument();
  });

  it("keeps the buttons up when the write fails, so the reviewer can try again", async () => {
    // Closing back to a status that did not change would read as success.
    onResolve.mockResolvedValue(false);
    renderQueue("approved");
    await showResolved();
    await userEvent.click(screen.getByRole("button", { name: /Change the decision/ }));
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("does not offer it on a stop still awaiting review", async () => {
    // A pending row already has Approve and Reject; a second control there
    // would be two ways to do one thing.
    renderQueue("pending");
    expect(screen.queryByRole("button", { name: /Change the decision/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
