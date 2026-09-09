import { describe, expect, it } from "vitest";
import { reviewDisplay } from "./reviewDisplay.js";

// Review writes a recommendation; finalization turns it into the binding
// decision. Until then the binding column is empty and must not read as
// "pending review" for an item a reviewer has already handled.
describe("reviewDisplay", () => {
  it("shows the recommendation while the month is under review, in validation, or stale", () => {
    for (const status of ["in_review", "in_validation", "stale", "reopened"] as const) {
      expect(reviewDisplay(status, { recommended_action: "waived", manager_action: "pending" })).toEqual({ heading: "Recommendation", value: "waived" });
    }
  });
  it("says an unreviewed item is awaiting review, not pending binding", () => {
    expect(reviewDisplay("in_review", { recommended_action: null, manager_action: "pending" })).toEqual({ heading: "Recommendation", value: "awaiting review" });
  });
  it("shows the binding decision once the month is finalized or issued", () => {
    expect(reviewDisplay("finalized", { recommended_action: "adjusted", manager_action: "adjusted" })).toEqual({ heading: "Binding decision", value: "adjusted" });
    expect(reviewDisplay("issued", { recommended_action: "confirmed", manager_action: "confirmed" })).toEqual({ heading: "Binding decision", value: "confirmed" });
  });
  it("has nothing to show before compute", () => {
    expect(reviewDisplay("open", { recommended_action: null, manager_action: "pending" })).toEqual({ heading: "Recommendation", value: "—" });
  });
});
