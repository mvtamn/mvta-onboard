import assert from "node:assert/strict";
import test from "node:test";
import { buildReportModel, type ReportPeriodRow, type ReportItemRow } from "./buildReportModel";

const period: ReportPeriodRow = { contractor_name: "Transit Operations", service_month: "202607", is_partial: false, proposed_total: 1500, final_total: null };
const item = (over: Partial<ReportItemRow> = {}): ReportItemRow => ({
  name: "Fixed-route OTP", standard_type: "threshold", metric_display: "79%", target_display: "85% or above", tier_label: "tier1",
  assessment_outcome: "tier1", occurrence_count: 0, base_amount: 1500, escalation_multiplier: 1, proposed_amount: 1500,
  recommended_action: null, recommended_amount: null, recommendation_reason: null,
  manager_action: "pending", manager_reason: null, final_amount: null, binding_amount: null, binding_reason: null,
  excluded_occurrence_count: 0, excluded_unit_quantity: 0, data_completeness_pct: 100, ...over,
});

test("a Validation Draft shows the reviewed recommendation, not the raw proposal", () => {
  const model = buildReportModel({ reportId: "r1", type: "preliminary", version: 1, period, rows: [item({ recommended_action: "waived", recommended_amount: 0, recommendation_reason: "Documented detour" })], evidence: [], issuedAt: null, deadline: null });
  assert.equal(model.assessments[0].computedAmount, 1500);
  assert.equal(model.assessments[0].reviewAction, "waived");
  assert.equal(model.assessments[0].reviewReason, "Documented detour");
  assert.equal(model.assessments[0].assessedAmount, 0);
  // The draft's total is the sum of what review recommends - the figure finalization will bind.
  assert.equal(model.assessedTotal, 0);
});

test("an unreviewed item on a Validation Draft falls back to the proposal and says so", () => {
  const model = buildReportModel({ reportId: "r1", type: "preliminary", version: 1, period, rows: [item()], evidence: [], issuedAt: null, deadline: null });
  assert.equal(model.assessments[0].reviewAction, "pending");
  assert.equal(model.assessments[0].assessedAmount, 1500);
  assert.equal(model.assessedTotal, 1500);
});

test("a Final Assessment shows the binding decision and the period's bound total", () => {
  const model = buildReportModel({ reportId: "r2", type: "final", version: 1, period: { ...period, final_total: 750 }, rows: [item({ recommended_action: "adjusted", recommended_amount: 750, recommendation_reason: "Half the trips were MVTA-directed", manager_action: "adjusted", manager_reason: "Half the trips were MVTA-directed", final_amount: 750, binding_amount: 750, binding_reason: "Half the trips were MVTA-directed" })], evidence: [], issuedAt: new Date("2026-08-10T15:05:00Z"), deadline: new Date("2026-08-24T00:00:00Z") });
  assert.equal(model.assessments[0].computedAmount, 1500);
  assert.equal(model.assessments[0].reviewAction, "adjusted");
  assert.equal(model.assessments[0].assessedAmount, 750);
  assert.equal(model.assessedTotal, 750);
  assert.equal(model.disputeDeadline, "2026-08-24");
});

test("computed amount is base times escalation; relief is an excluded input, not a subtraction", () => {
  const model = buildReportModel({ reportId: "r1", type: "preliminary", version: 1, period, rows: [item({ base_amount: 1000, escalation_multiplier: 1.5, proposed_amount: 1500, excluded_occurrence_count: 2 })], evidence: [], issuedAt: null, deadline: null });
  assert.equal(model.assessments[0].computedAmount, 1500);
  assert.equal(model.assessments[0].excludedOccurrenceCount, 2);
  assert.equal("reliefAmount" in model.assessments[0], false);
});
