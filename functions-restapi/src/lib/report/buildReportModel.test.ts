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

// Design §9 sections 6, 7, 8, 9 and 11: the schedules a contractor needs to
// dispute a figure, what was removed in their favour, what they must submit,
// and where each number came from.
const schedules = {
  occurrences: [
    { standard_name: "Missed trips", service_date: "20260712", description: "Trip 4401 not operated", quantity: 1, qualifier_code: null, attribution: "contractor_error", source_ref: "MonitoredMissedTrips:gtfs:4401|20260712", claim_status: null, claim_description: null, evidence_hashes: null },
    { standard_name: "Missed trips", service_date: "20260713", description: "Trip 4402 not operated", quantity: 1, qualifier_code: "LAST_TRIP_OF_DAY", attribution: "contractor_error", source_ref: "MonitoredMissedTrips:gtfs:4402|20260713", claim_status: "approved", claim_description: "Ice storm, 24-hour notice given", evidence_hashes: "a".repeat(64)+"|"+"b".repeat(64) },
    { standard_name: "Missed trips", service_date: "20260714", description: "Trip 4403 not operated", quantity: 1, qualifier_code: null, attribution: "mvta_directed", source_ref: "MonitoredMissedTrips:gtfs:4403|20260714", claim_status: null, claim_description: null, evidence_hashes: null },
  ],
  exceptions: [{ standard_name: "Operator conduct", reason: "Nexus export not received", missing_data_owner: "Rob", remediation_action: "Request July export", expected_correction_date: new Date("2026-08-20T00:00:00Z") }],
  caps: [{ standard_name: "Fixed-route OTP", trigger_reason: "tier_rule", due_at: new Date("2026-08-17T00:00:00Z"), status: "required", cap_reason: null }, { standard_name: "Missed trips", trigger_reason: null, due_at: null, status: null, cap_reason: "tier_rule" }],
  standards: [
    { name: "Fixed-route OTP", standard_type: "threshold", measurement_source: "api_feed", data_completeness_pct: 100, assessment_outcome: "tier1" },
    { name: "Operator conduct", standard_type: "threshold", measurement_source: "manual_entry", data_completeness_pct: 0, assessment_outcome: "not_assessable" },
  ],
};

test("the occurrence schedule lists every confirmed occurrence and says which were counted", () => {
  const model = buildReportModel({ reportId: "r1", type: "final", version: 1, period, rows: [item()], evidence: [], issuedAt: null, deadline: null, schedules });
  assert.deepEqual(model.occurrences.map(o => ({ date: o.serviceDate, counted: o.counted, why: o.exclusionReason })), [
    { date: "20260712", counted: true, why: null },
    { date: "20260713", counted: false, why: "Approved excusable-delay claim: Ice storm, 24-hour notice given" },
    { date: "20260714", counted: false, why: "Attributed to MVTA direction" },
  ]);
  assert.equal(model.occurrences[1].qualifierCode, "LAST_TRIP_OF_DAY");
  assert.equal(model.occurrences[0].sourceRef, "MonitoredMissedTrips:gtfs:4401|20260712");
  assert.deepEqual(model.occurrences[1].evidenceHashes, ["a".repeat(64), "b".repeat(64)]);
});

test("exceptions, CAPs, and data sources travel with the report", () => {
  const model = buildReportModel({ reportId: "r1", type: "final", version: 1, period, rows: [item()], evidence: [], issuedAt: null, deadline: null, schedules });
  assert.deepEqual(model.exceptions, [{ standardName: "Operator conduct", reason: "Nexus export not received", missingDataOwner: "Rob", remediationAction: "Request July export", expectedCorrectionDate: "2026-08-20" }]);
  // A determination without a plan row yet (rendered at proof time) still appears, due at the issuance clock.
  assert.deepEqual(model.caps, [{ standardName: "Fixed-route OTP", triggerReason: "tier_rule", dueAt: "2026-08-17", status: "required" }, { standardName: "Missed trips", triggerReason: "tier_rule", dueAt: null, status: "required" }]);
  assert.deepEqual(model.dataSources, [
    { standardName: "Fixed-route OTP", source: "Ingested from a feed", handEntered: false, dataCompletenessPct: 100, notAssessable: false },
    { standardName: "Operator conduct", source: "Entered by hand", handEntered: true, dataCompletenessPct: 0, notAssessable: true },
  ]);
});

test("a report with no schedules still builds", () => {
  const model = buildReportModel({ reportId: "r1", type: "preliminary", version: 1, period, rows: [item()], evidence: [], issuedAt: null, deadline: null });
  assert.deepEqual([model.occurrences, model.exceptions, model.caps, model.dataSources, model.otpExclusions], [[], [], [], [], []]);
});

test("a CAP determination with no plan row yet takes the issuance clock when it is known", () => {
  const model = buildReportModel({ reportId: "r2", type: "final", version: 1, period, rows: [item()], evidence: [], issuedAt: new Date("2026-08-10T15:05:00Z"), deadline: null, schedules: { caps: [{ standard_name: "Missed trips", trigger_reason: null, due_at: null, status: null, cap_reason: "tier_rule" }], capDeadline: new Date("2026-08-17T00:00:00Z") } });
  assert.deepEqual(model.caps, [{ standardName: "Missed trips", triggerReason: "tier_rule", dueAt: "2026-08-17", status: "required" }]);
});

test("OTP stop exclusions are reported by reason code", () => {
  const model = buildReportModel({ reportId: "r1", type: "final", version: 1, period, rows: [item()], evidence: [], issuedAt: null, deadline: null, schedules: { otpExclusions: [{ reason_code: "LAYOVER", stop_count: 12 }] } });
  assert.deepEqual(model.otpExclusions, [{ reasonCode: "LAYOVER", stopCount: 12 }]);
});
