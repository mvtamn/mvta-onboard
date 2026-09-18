import { describe, expect, it } from "vitest";
import type { MissedTripsMonthlySummaryRow } from "@mvta/shared";
import { buildReviewRequest, confirmBlockedReason, inView, lifecycleLabel, outcomeLabel, pivotMonthlySummary, reviewMode } from "./missedTripReview.js";

const base = { tripId: "T1", serviceDate: "20260917", lifecycle: "ready_for_review" as const, validationStatus: "unreviewed" as const, heldReason: null };
const drafts = { reasonCode: "RAN", notes: "", attribution: "contractor_error" as const, changeReason: "" };

describe("missed-trip review requests", () => {
  it("a first review needs only a reason, and only a confirmation carries attribution", () => {
    const confirmed = buildReviewRequest(base, "confirmed", drafts);
    expect(confirmed).toEqual({ input: { trip_id: "T1", service_date: "20260917", validation_status: "confirmed", reason_code: "RAN", notes: undefined, attribution: "contractor_error" } });
    const timely = buildReviewRequest(base, "timely_service", drafts);
    expect("input" in timely && timely.input.attribution).toBe(undefined);
    expect(buildReviewRequest(base, "indeterminate", { ...drafts, reasonCode: "" })).toEqual({ error: "Select a reason before saving the review." });
  });

  it("changing a review sends supersede_reason; a legacy record sends rereview_reason", () => {
    const reviewed = { ...base, lifecycle: "reviewed" as const, validationStatus: "confirmed" as const };
    expect(reviewMode(reviewed)).toBe("supersede");
    expect(buildReviewRequest(reviewed, "timely_service", drafts)).toEqual({ error: "Say why the earlier review is being changed." });
    const superseding = buildReviewRequest(reviewed, "timely_service", { ...drafts, changeReason: " AVL shows it ran " });
    expect("input" in superseding && superseding.input.supersede_reason).toBe("AVL shows it ran");

    const legacy = { ...base, lifecycle: "legacy" as const };
    expect(reviewMode(legacy)).toBe("rereview");
    const rereview = buildReviewRequest(legacy, "indeterminate", { ...drafts, changeReason: "Rechecked" });
    expect("input" in rereview && rereview.input.rereview_reason).toBe("Rechecked");
  });

  it("confirmation waits for evidence; other outcomes do not", () => {
    const held = { ...base, lifecycle: "awaiting_evidence" as const, heldReason: "awaiting_confirmation" };
    expect(confirmBlockedReason(held)).toBe("Not ready to confirm: waiting for a second check to agree.");
    expect(buildReviewRequest(held, "confirmed", drafts)).toEqual({ error: "Not ready to confirm: waiting for a second check to agree." });
    expect("input" in buildReviewRequest(held, "indeterminate", drafts)).toBe(true);
  });

  it("labels and views follow the classification", () => {
    expect(outcomeLabel("false_positive")).toBe("Timely service");
    expect(lifecycleLabel({ lifecycle: "reviewed", validationStatus: "confirmed" })).toBe("Missed");
    expect(lifecycleLabel({ lifecycle: "reviewed", validationStatus: "partial_service_failure" })).toBe("Partial-service failure");
    expect(inView({ inQueue: true, concluded: false }, "queue")).toBe(true);
    expect(inView({ inQueue: false, concluded: true }, "queue")).toBe(false);
    expect(inView({ inQueue: false, concluded: true }, "history")).toBe(true);
  });
});

describe("pivotMonthlySummary", () => {
  const row = (overrides: Partial<MissedTripsMonthlySummaryRow> = {}): MissedTripsMonthlySummaryRow => ({
    service_month: "202608", route_id: "460", source_system: "gtfs",
    detection_type: "silent_no_show", detector: "gtfs_silent_no_show",
    lifecycle: "reviewed", evidence_finding: "suspected_no_show",
    review_outcome: "confirmed_missed_trip", counts_as_missed: true,
    counts_toward_assessment: false, trip_count: 1, ...overrides,
  });

  it("sums the buckets the server classified, not the stored status", () => {
    const [month] = pivotMonthlySummary([
      row({ trip_count: 3 }),
      row({ trip_count: 2, counts_toward_assessment: true }),
      row({ review_outcome: "timely_service", counts_as_missed: false, trip_count: 4 }),
      row({ review_outcome: "partial_service_failure", counts_as_missed: false, trip_count: 1 }),
      row({ review_outcome: "indeterminate", counts_as_missed: false, trip_count: 1 }),
      row({ lifecycle: "ready_for_review", review_outcome: null, counts_as_missed: false, trip_count: 5 }),
      row({ detector: "gtfs_cancellation", detection_type: "explicit_cancellation", trip_count: 2 }),
    ]);
    expect(month).toMatchObject({
      service_month: "202608", route_id: "460",
      cancellations: 2, noShows: 16, spareCandidates: 0,
      confirmedMissed: 7, countingTowardAssessment: 2,
      timelyService: 4, otherOutcome: 2, awaitingReview: 5, total: 18,
    });
  });

  it("keeps each month, route and source system apart, newest month first", () => {
    const rows = pivotMonthlySummary([
      row({ service_month: "202607" }),
      row({ route_id: "9" }),
      row({ route_id: "10" }),
      row({ source_system: "spare", detector: "spare", detection_type: "spare_late_start" }),
    ]);
    expect(rows.map((r) => [r.service_month, r.route_id, r.source_system])).toEqual([
      ["202608", "9", "gtfs"],
      ["202608", "10", "gtfs"],
      ["202608", "460", "spare"],
      ["202607", "460", "gtfs"],
    ]);
    expect(rows[2].spareCandidates).toBe(1);
  });
});
