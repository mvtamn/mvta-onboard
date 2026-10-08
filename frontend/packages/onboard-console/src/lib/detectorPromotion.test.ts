import { describe, expect, it } from "vitest";
import {
  draftErrors,
  decisionTitle,
  EMPTY_DRAFT,
  ignoredWarning,
  measurementText,
  promotionInput,
  serviceDateKey,
  serviceDateLabel,
  standingSentence,
  type PromotionDraft,
} from "./detectorPromotion.js";

const draft = (overrides: Partial<PromotionDraft> = {}): PromotionDraft => ({
  ...EMPTY_DRAFT,
  effectiveDate: "2026-10-01",
  reason: "97.2% over the service week of 21 September",
  precisionPercent: "97.2",
  sampleSize: "143",
  ...overrides,
});

describe("what the page says", () => {
  it("reads a service date key as a date", () => {
    expect(serviceDateLabel("20260901")).toContain("2026");
    expect(serviceDateLabel("")).toBe("—");
    expect(serviceDateLabel("not a date")).toBe("not a date");
  });

  it("says where a detector stands, and what Shadow detection means for it", () => {
    expect(standingSentence({ detector: "spare", promoted: false, since: null }))
      .toContain("never reach an assessment");
    expect(standingSentence({ detector: "spare", promoted: true, since: "20260901" }))
      .toMatch(/^Counts toward assessments from /);
  });

  it("shows the evidence a decision was made on", () => {
    expect(measurementText({ measured_precision: 0.972, sample_size: 143 })).toBe("97.2% precision over 143 cases");
    expect(measurementText({ measured_precision: 0.972, sample_size: null })).toBe("97.2% precision");
    expect(measurementText({ measured_precision: null, sample_size: null })).toBe("No measurement recorded");
  });

  it("names a demotion as what it is", () => {
    expect(decisionTitle({ detector: "spare", promoted: false })).toContain("Shadow detection");
  });

  it("warns about detector names this build does not know", () => {
    expect(ignoredWarning([])).toBeNull();
    expect(ignoredWarning(["gtfs_silent_noshow"])).toContain("promotes nothing");
    expect(ignoredWarning(["a", "b"])).toContain("promote nothing");
  });
});

describe("what the form will not send", () => {
  it("accepts a promotion that clears the bar", () => {
    expect(draftErrors(draft())).toEqual({});
    expect(promotionInput(draft())).toEqual({
      detector: "gtfs_silent_no_show", effective_service_date: "20261001", promoted: true,
      reason: "97.2% over the service week of 21 September",
      measured_precision: 0.972, sample_size: 143, on_demand_conditions_met: undefined,
    });
  });

  it("refuses a promotion below CONTEXT's bar, in the field it belongs to", () => {
    expect(draftErrors(draft({ precisionPercent: "88" })).precisionPercent).toContain("95%");
    expect(draftErrors(draft({ precisionPercent: "101" })).precisionPercent).toContain("above 100%");
    expect(draftErrors(draft({ precisionPercent: "" })).precisionPercent).toBeTruthy();
    expect(draftErrors(draft({ sampleSize: "0" })).sampleSize).toBeTruthy();
  });

  it("asks the on-demand detector for its extra conditions", () => {
    expect(draftErrors(draft({ detector: "spare" })).onDemandConditionsMet).toBeTruthy();
    expect(draftErrors(draft({ detector: "spare", onDemandConditionsMet: true }))).toEqual({});
  });

  it("asks a demotion for a reason and a date, and nothing else", () => {
    const out = draft({ promoted: false, precisionPercent: "", sampleSize: "", reason: "misfiring on short turns" });
    expect(draftErrors(out)).toEqual({});
    expect(promotionInput(out).measured_precision).toBeNull();
    expect(draftErrors({ ...out, reason: "  " }).reason).toContain("taken back out");
    expect(draftErrors({ ...out, effectiveDate: "" }).effectiveDate).toBeTruthy();
  });

  it("turns a date input into the service date key the server wants", () => {
    expect(serviceDateKey("2026-10-01")).toBe("20261001");
    expect(serviceDateKey("October")).toBe("");
  });
});
