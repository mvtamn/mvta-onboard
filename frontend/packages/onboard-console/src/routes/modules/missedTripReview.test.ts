import { describe, expect, it } from "vitest";
import { buildReviewRequest, confirmBlockedReason, inView, lifecycleLabel, outcomeLabel, reviewMode } from "./missedTripReview.js";

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
