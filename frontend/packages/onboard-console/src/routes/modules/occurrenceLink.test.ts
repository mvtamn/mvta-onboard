import { describe, expect, it } from "vitest";
import { occurrenceSummary, serviceMonthLabel } from "./garageDepartures.shared.js";

const base = {
  occurrence_id: null, occurrence_review_status: null, occurrence_attribution: null,
  occurrence_service_month: null, occurrence_period_status: null,
} as const;

describe("where a departure landed in the performance assessment", () => {
  it("says nothing was raised when the rule did not judge it a breach", () => {
    const summary = occurrenceSummary(base, "20260904");
    expect(summary.label).toBe("Not raised");
    expect(summary.tone).toBe("none");
  });

  it("distinguishes a raised-but-unsettled occurrence from a charged one", () => {
    // The distinction the departure views could not previously draw: both of
    // these show as a late pullout, and only one of them costs money.
    const pending = occurrenceSummary({ ...base, occurrence_id: "o1", occurrence_review_status: "candidate", occurrence_service_month: "202609" }, "20260904");
    expect(pending.label).toBe("Awaiting review");
    expect(pending.tone).toBe("pending");
    expect(pending.detail).toMatch(/not charged until someone says whose error/);

    const charged = occurrenceSummary({ ...base, occurrence_id: "o1", occurrence_review_status: "confirmed", occurrence_attribution: "contractor_error", occurrence_service_month: "202609" }, "20260904");
    expect(charged.label).toBe("Counted in September 2026");
    expect(charged.tone).toBe("counted");
  });

  it("names why a recorded occurrence carries no penalty", () => {
    expect(occurrenceSummary({ ...base, occurrence_id: "o1", occurrence_review_status: "dismissed", occurrence_attribution: "excusable", occurrence_service_month: "202609" }, "20260904").detail)
      .toMatch(/as an excusable delay/);
    expect(occurrenceSummary({ ...base, occurrence_id: "o1", occurrence_review_status: "dismissed", occurrence_attribution: "mvta_directed", occurrence_service_month: "202609" }, "20260904").detail)
      .toMatch(/as MVTA-directed/);
  });

  it("says when the month it landed in is already closed", () => {
    const summary = occurrenceSummary({ ...base, occurrence_id: "o1", occurrence_review_status: "confirmed", occurrence_attribution: "contractor_error", occurrence_service_month: "202608", occurrence_period_status: "issued" }, "20260825");
    expect(summary.detail).toMatch(/which is now issued/);
  });

  it("falls back to the service date's own month when the occurrence names none", () => {
    expect(serviceMonthLabel(null, "20260904")).toBe("September 2026");
    expect(serviceMonthLabel("202601", "20260904")).toBe("January 2026");
  });
});
