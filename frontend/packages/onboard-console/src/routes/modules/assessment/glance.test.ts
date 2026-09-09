import { describe, expect, it } from "vitest";
import type { AssessmentPeriod, ComplianceOccurrence, PeriodKpiAssessment } from "@mvta/shared";
import { currentMonth, lifecycleStages, nextAction, occurrencesNeedingAmount, outstandingItems, periodFor, reviewProgress, statusPill, stepMonth } from "./glance.js";

const row = (overrides: Partial<PeriodKpiAssessment>): PeriodKpiAssessment => ({
  id: "r", period_id: "p", standard_id: "s", code: "X", name: "X", standard_type: "occurrence", priority: "High",
  metric_display: "1", tier_label: "meets", occurrence_count: 0, proposed_amount: 0, final_amount: null,
  manager_action: "pending", manager_reason: null, data_completeness_pct: 100, ...overrides,
});
const occurrence = (overrides: Partial<ComplianceOccurrence>): ComplianceOccurrence => ({
  id: "o", standard_id: "s", standard_code: "X", standard_name: "X", contractor_id: "c", contractor_name: "C",
  service_date: "20260801", quantity: 1, description: "", source: "manual", review_status: "confirmed", attribution: "contractor_error", ...overrides,
});
const period = (overrides: Partial<AssessmentPeriod>): AssessmentPeriod => ({
  id: "p", contractor_id: "c", contractor_name: "C", service_month: "202608", status: "open",
  input_revision: 1, computed_revision: null, proposed_total: 0, final_total: null, ...overrides,
});

describe("stepMonth", () => {
  it("crosses year boundaries in both directions", () => {
    expect(stepMonth("202601", -1)).toBe("202512");
    expect(stepMonth("202612", 1)).toBe("202701");
    expect(stepMonth("202608", 0)).toBe("202608");
  });
});

describe("lifecycleStages", () => {
  const states = (status: Parameters<typeof lifecycleStages>[0]) => lifecycleStages(status).map((s) => s.state);
  it("names the stages CONTEXT.md's Assessment Lifecycle names", () => {
    // The vocabulary a contractor and an auditor already read on the
    // artifacts; the card does not invent a parallel progression.
    expect(lifecycleStages(null).map((s) => s.label))
      .toEqual(["Open", "Under Review", "In Validation", "Finalized", "Issued"]);
  });
  it("marks the stages before the current one done", () => {
    expect(states("in_review")).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
  });
  it("keeps a stale month at Under Review rather than sending it back to Open", () => {
    expect(states("stale")).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
    // The pill is where a stale month says so.
    expect(statusPill("stale").label).toMatch(/Stale/);
    expect(states("reopened")[0]).toBe("current");
  });
  it("shows an issued month as finished and an unopened one as untouched", () => {
    expect(states("issued")).toEqual(Array(5).fill("done"));
    expect(states(null)).toEqual(Array(5).fill("upcoming"));
    expect(statusPill(null).label).toBe("Not opened");
  });
});

describe("nextAction", () => {
  it("offers to open a month that has no period", () => {
    expect(nextAction(null, 0)).toEqual({ kind: "open", label: "Open Assessment Period" });
  });
  it("computes an open month and recomputes a stale one", () => {
    expect(nextAction("open", 0).kind).toBe("compute");
    expect(nextAction("stale", 0).label).toBe("Recompute");
  });
  it("sends the reader to review while items are pending, and on to the report once none are", () => {
    expect(nextAction("in_review", 3)).toEqual({ kind: "go", label: "Continue review", page: "review" });
    expect(nextAction("in_review", 0)).toEqual({ kind: "go", label: "Prepare Validation Draft", page: "issuance" });
  });
  it("only offers Finalize when nothing is pending, matching the review page's gate", () => {
    expect(nextAction("in_validation", 1).kind).toBe("go");
    expect(nextAction("in_validation", 0).kind).toBe("finalize");
  });
  it("does not promise a review that the status has already closed", () => {
    // Every review control is gated on in_review, so "Continue review" here
    // would land the reader on a page where nothing can be pressed.
    expect(nextAction("in_validation", 2)).toEqual({ kind: "go", label: "See what is pending", page: "review" });
    expect(nextAction("in_review", 2).label).toBe("Continue review");
  });
});

describe("reviewProgress", () => {
  it("counts only the rows a reviewer can act on", () => {
    // A not_assessable row has no figure to recommend and is excluded from
    // "awaiting review", so counting it in the denominator would leave the
    // tally unreachable - "1 of 2 reviewed" beside "Nothing outstanding".
    const rows = [
      row({ id: "a", recommended_action: "confirmed" }),
      row({ id: "b", assessment_outcome: "not_assessable" }),
    ];
    expect(reviewProgress(rows)).toEqual({ reviewed: 1, total: 1 });
    expect(outstandingItems(rows, []).some((i) => i.key === "review")).toBe(false);
  });
  it("is zero of zero when there is nothing scored", () => {
    expect(reviewProgress([])).toEqual({ reviewed: 0, total: 0 });
  });
});

describe("occurrencesNeedingAmount", () => {
  const ranged = { penalty_amount_min: 2500, penalty_amount_max: 10000 } as Partial<ComplianceOccurrence>;
  it("counts a confirmed ranged occurrence with no figure set", () => {
    expect(occurrencesNeedingAmount([occurrence({ ...ranged })])).toBe(1);
  });
  it("ignores one a reviewer has already priced, and one not yet confirmed", () => {
    expect(occurrencesNeedingAmount([occurrence({ ...ranged, assessed_amount: 4000 })])).toBe(0);
    expect(occurrencesNeedingAmount([occurrence({ ...ranged, review_status: "pending" })])).toBe(0);
  });
  it("ignores an occurrence whose penalty is a fixed amount", () => {
    expect(occurrencesNeedingAmount([occurrence({})])).toBe(0);
  });
  it("is the same reading the Outstanding line uses", () => {
    // The section count and the card's line must not disagree about what is
    // outstanding in Occurrences.
    const occurrences = [occurrence({ ...ranged }), occurrence({ id: "o2", ...ranged })];
    const line = outstandingItems([], occurrences).find((i) => i.key === "amount");
    expect(line?.label).toContain(String(occurrencesNeedingAmount(occurrences)));
  });
});

describe("currentMonth", () => {
  it("is YYYYMM in the reader's own month", () => {
    expect(currentMonth(new Date(2026, 8, 9))).toBe("202609");
    expect(currentMonth(new Date(2026, 0, 31))).toBe("202601");
  });
});

describe("outstandingItems", () => {
  it("lists what blocks the month, each pointing at the section where it is done", () => {
    const rows = [
      row({ id: "a", proposed_amount: 3500 }),
      row({ id: "b", proposed_amount: 2400 }),
      row({ id: "c", proposed_amount: 1500, recommended_action: "adjusted", recommended_amount: 750 }),
      row({ id: "d", assessment_outcome: "not_assessable" }),
      row({ id: "e", tier_label: "tier2", recommended_action: "confirmed", cap_required: true }),
    ];
    const occurrences = [
      occurrence({ id: "1", penalty_amount_min: 2500, penalty_amount_max: 10000 }),
      occurrence({ id: "2", penalty_amount_min: 2500, penalty_amount_max: 10000, assessed_amount: 4200 }),
      occurrence({ id: "3", review_status: "candidate", penalty_amount_min: 2500, penalty_amount_max: 10000 }),
    ];
    expect(outstandingItems(rows, occurrences)).toEqual([
      { key: "review", page: "review", label: "2 items awaiting review · $5,900" },
      { key: "metrics", page: "metrics", label: "1 monthly figure missing" },
      { key: "amount", page: "occurrences", label: "1 occurrence needs an amount" },
      { key: "caps", page: "caps", label: "1 CAP flagged", quiet: true },
    ]);
  });
  it("is empty when nothing is outstanding", () => {
    expect(outstandingItems([row({ recommended_action: "confirmed" })], [])).toEqual([]);
  });
  it("does not count a not-assessable row as awaiting review", () => {
    expect(outstandingItems([row({ assessment_outcome: "not_assessable" })], []).map((i) => i.key)).toEqual(["metrics"]);
  });
});

describe("periodFor", () => {
  it("prefers the correction period over the one it supersedes", () => {
    const original = period({ id: "p1", status: "issued" });
    const correction = period({ id: "p2", status: "open", supersedes_period_id: "p1" });
    expect(periodFor([original, correction], "c", "202608")?.id).toBe("p2");
    expect(periodFor([original, correction], "c", "202607")).toBeUndefined();
    expect(periodFor([original], "other", "202608")).toBeUndefined();
  });
});
