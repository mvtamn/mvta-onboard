import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FlaggedStop, OtpStopExclusion, ReasonCode } from "@mvta/shared";
// NOT @mvta/shared's StopExclusionStatus: that one is what the database
// stores, "approved" | "rejected". The queue's own adds "pending", which is a
// stop nobody has decided yet rather than a row with a status.
import type { StopExclusionStatus } from "./otpData.js";
import { ReviewQueuePage } from "./OtpReviewQueue.js";
import { AppDialogProvider } from "../../../components/AppDialog.js";
import { queueRow } from "./otpFigures.js";

vi.mock("../../../config.js", () => ({ api: { getOtpAuditStream: vi.fn().mockResolvedValue({ entries: [] }) } }));

const stop = (over: Partial<FlaggedStop> = {}): FlaggedStop => ({
  route_id: 444, route_label: "444", stop_id: 51234, stop_name: "Apple Valley Transit Station",
  day_of_week: "Mon", total: 120, pct_early: 0.22, pct_ontime: 0.7, pct_late: 0.05, pct_missed: 0.03, ...over,
});
// One stop, flagged on three weekdays - the shape October 2026 had, where
// one stop sat in the old flat list fifteen times.
const week = [stop(), stop({ day_of_week: "Tues" }), stop({ day_of_week: "Wed" })];

const reasonCodes: ReasonCode[] = [
  { id: "rc1", code: "RECOVERY", label: "Recovery point", applies_to: "stop", sort_order: 1, is_active: true, updated_by: null, updated_at: "2026-09-01T00:00:00Z" },
  { id: "rc2", code: "LAYOVER", label: "Layover", applies_to: "stop", sort_order: 2, is_active: true, updated_by: null, updated_at: "2026-09-01T00:00:00Z" },
];

const onResolve = vi.fn();
const onReason = vi.fn();
const onCopy = vi.fn();
const onResetMonth = vi.fn();

function renderQueue({
  stops = week,
  statusOf = () => "pending" as StopExclusionStatus,
  decidedCount = 0,
  previousDecisionFor = () => undefined as OtpStopExclusion | undefined,
}: {
  stops?: FlaggedStop[];
  statusOf?: (s: FlaggedStop) => StopExclusionStatus;
  decidedCount?: number;
  previousDecisionFor?: (s: FlaggedStop) => OtpStopExclusion | undefined;
} = {}) {
  return render(
    <AppDialogProvider>
      <ReviewQueuePage
        flaggedStops={stops}
        queueRows={stops.map(queueRow)}
        statusOf={statusOf}
        reasonOf={() => "RECOVERY"}
        reasonCodes={reasonCodes}
        onResolve={onResolve}
        onReason={onReason}
        serviceMonth="202609"
        auditRefreshTick={0}
        previousDecisionFor={previousDecisionFor}
        onCopy={onCopy}
        onCopyAll={vi.fn()}
        copyingAll={false}
        decidedCount={decidedCount}
        onResetMonth={onResetMonth}
        resetting={false}
      />
    </AppDialogProvider>,
  );
}

const day = (name: RegExp) => screen.getByRole("button", { name });

/** Decided groups are hidden under the default "pending" filter. */
async function showDecided() {
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "resolved");
}

beforeEach(() => {
  onResolve.mockReset(); onResolve.mockResolvedValue(true);
  onReason.mockReset(); onCopy.mockReset();
  onResetMonth.mockReset(); onResetMonth.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("deciding a stop", () => {
  it("shows one card for a stop however many weekdays flagged it, and decides them together", async () => {
    renderQueue();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Stop 51234 · Early-biased · 3 days · 360 departures")).toBeInTheDocument();
    expect(day(/^Monday, pending/)).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Exclude 3 days" }));

    expect(onResolve).toHaveBeenCalledWith(week, "approve");
  });

  it("lets a day be carved out, and names the day when only one is left", async () => {
    renderQueue();
    await userEvent.click(day(/^Tuesday, pending/));
    expect(day(/^Tuesday, pending/)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Keep 2 days" })).toBeInTheDocument();

    await userEvent.click(day(/^Monday, pending/));
    await userEvent.click(screen.getByRole("button", { name: "Exclude Wed" }));

    expect(onResolve).toHaveBeenCalledWith([week[2]], "approve");
  });

  it("applies the reason to the days the decision will cover", async () => {
    renderQueue();
    await userEvent.click(day(/^Wednesday, pending/));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Reason for Apple Valley/ }), "LAYOVER");

    expect(onReason.mock.calls).toEqual([[week[0], "LAYOVER"], [week[1], "LAYOVER"]]);
  });

  it("keeps the controls up when the write fails, so the reviewer can try again", async () => {
    // Closing back to a status that did not change would read as success.
    onResolve.mockResolvedValue(false);
    renderQueue();
    await userEvent.click(day(/^Tuesday, pending/));
    await userEvent.click(screen.getByRole("button", { name: "Exclude 2 days" }));

    expect(screen.getByRole("button", { name: "Exclude 2 days" })).toBeInTheDocument();
    expect(day(/^Tuesday, pending/)).toHaveAttribute("aria-pressed", "false");
  });

  it("offers to copy last month only for the days last month decided", async () => {
    const previous = (s: FlaggedStop) =>
      s.day_of_week === "Wed" ? undefined : ({ status: "approved", reason_code: "RECOVERY", day_of_week: s.day_of_week } as OtpStopExclusion);
    renderQueue({ previousDecisionFor: previous });
    expect(screen.getByText("Last month: excluded — Recovery point")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Copy last month" }));
    expect(onCopy).toHaveBeenCalledWith([week[0], week[1]]);
  });
});

describe("changing a decision that is already made", () => {
  // The API always allowed this - PUT /otp-stop-exclusions upserts in place -
  // but a decided stop rendered as static text, so a reviewer who excluded the
  // wrong stop had no way back through the console.
  it("offers Change decision on an excluded stop, and re-decides every day", async () => {
    renderQueue({ statusOf: () => "approved", decidedCount: 3 });
    await showDecided();
    expect(screen.getByText("Excluded — Recovery point")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Change the decision/ }));
    await userEvent.click(screen.getByRole("button", { name: "Keep 3 days" }));

    expect(onResolve).toHaveBeenCalledWith(week, "reject");
  });

  it("offers it on a kept stop too, so an exclusion can be put back", async () => {
    renderQueue({ statusOf: () => "rejected", decidedCount: 3 });
    await showDecided();
    expect(screen.getByText("Kept in OTP calc")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Change the decision/ }));
    await userEvent.click(screen.getByRole("button", { name: "Exclude 3 days" }));

    expect(onResolve).toHaveBeenCalledWith(week, "approve");
  });

  it("closes the card again on Cancel without deciding anything", async () => {
    renderQueue({ statusOf: () => "approved", decidedCount: 3 });
    await showDecided();
    await userEvent.click(screen.getByRole("button", { name: /Change the decision/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByText("Excluded — Recovery point")).toBeInTheDocument();
  });

  it("lets a decided day be pressed to re-decide it alongside the pending ones", async () => {
    // A half-decided week stays in the pending view; its decided days can be
    // brought back into the next decision without a separate control.
    renderQueue({ statusOf: (s) => (s.day_of_week === "Mon" ? "approved" : "pending"), decidedCount: 1 });
    expect(screen.getByRole("button", { name: "Exclude 2 days" })).toBeInTheDocument();

    await userEvent.click(day(/^Monday, excluded/));
    await userEvent.click(screen.getByRole("button", { name: "Keep 3 days" }));

    expect(onResolve).toHaveBeenCalledWith([week[0], week[1], week[2]], "reject");
  });

  it("does not offer Change decision on a stop still awaiting review", () => {
    renderQueue();
    expect(screen.queryByRole("button", { name: /Change the decision/ })).not.toBeInTheDocument();
  });
});

describe("working through the list", () => {
  const twoStops = [...week, stop({ stop_id: 51235, stop_name: "Burnsville Transit Station", day_of_week: "Mon" })];

  it("counts what is left and moves focus to the next card once a stop is decided", async () => {
    // The hook re-reads the month before resolve() returns, so the decided
    // card is already gone when the queue hands focus on. The mock does the
    // same: it re-renders with the new statuses before it resolves.
    const decided = new Set<string>();
    const statusOf = (s: FlaggedStop) => (decided.has(s.stop_id + s.day_of_week) ? "approved" : "pending") as StopExclusionStatus;
    const view = () => (
      <AppDialogProvider>
        <ReviewQueuePage
          flaggedStops={twoStops} queueRows={twoStops.map(queueRow)} statusOf={(s) => statusOf(s)}
          reasonOf={() => "RECOVERY"} reasonCodes={reasonCodes} onResolve={onResolve} onReason={onReason}
          serviceMonth="202609" auditRefreshTick={0} previousDecisionFor={() => undefined} onCopy={onCopy}
          onCopyAll={vi.fn()} copyingAll={false} decidedCount={decided.size} onResetMonth={onResetMonth} resetting={false}
        />
      </AppDialogProvider>
    );
    const { rerender } = render(view());
    onResolve.mockImplementation(async (stops: FlaggedStop[]) => {
      for (const s of stops) decided.add(s.stop_id + s.day_of_week);
      rerender(view());
      return true;
    });
    expect(screen.getByText("2 stops to review")).toBeInTheDocument();
    expect(screen.getByText(/4 of 4 stop-days pending/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Exclude 3 days" }));

    expect(screen.getByText("1 stop to review")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    const next = screen.getByRole("article", { name: /Burnsville Transit Station/ });
    expect(within(next).getByRole("button", { name: "Exclude Mon" })).toHaveFocus();
  });

  it("filters by route, by name or stop number, and offers a way back when nothing matches", async () => {
    renderQueue({ stops: twoStops });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search stops" }), "51235");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article", { name: /Burnsville/ })).toBeInTheDocument();

    await userEvent.clear(screen.getByRole("searchbox", { name: "Search stops" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search stops" }), "nowhere");
    expect(screen.getByText("No flagged stops match these filters.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("says so when every stop is decided", () => {
    renderQueue({ statusOf: () => "approved", decidedCount: 3 });
    expect(screen.getByText("Every flagged stop is decided.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all flagged stops" })).toBeInTheDocument();
  });
});

describe("resetting the month", () => {
  // A decision could be changed but never undone, so a month reviewed against
  // the wrong figures had no way back to pending through the console.
  it("resets the month once the reviewer confirms in the app's own dialog", async () => {
    renderQueue({ statusOf: () => "approved", decidedCount: 3 });
    await userEvent.click(screen.getByRole("button", { name: "Reset 09/2026 decisions" }));

    const dialog = screen.getByRole("dialog", { name: "Reset 09/2026 decisions?" });
    expect(dialog).toHaveTextContent(/deletes all 3 stop exclusion decisions for 09\/2026/);
    await userEvent.click(screen.getByRole("button", { name: "Reset 3 stop exclusion decisions" }));
    expect(onResetMonth).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the reviewer cancels", async () => {
    renderQueue({ statusOf: () => "approved", decidedCount: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Reset 09/2026 decisions" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onResetMonth).not.toHaveBeenCalled();
  });

  it("is not offered when the month has no decisions to clear", () => {
    renderQueue();
    expect(screen.queryByRole("button", { name: /Reset .* decisions/ })).not.toBeInTheDocument();
  });
});
