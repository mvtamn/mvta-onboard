import { describe, expect, it } from "vitest";
import type { ContractorPerformanceStandard, ManualMetricEntry, PeriodKpiAssessment } from "@mvta/shared";
import { metricsChecklist } from "./metricsChecklist.js";

const standard = (over: Partial<ContractorPerformanceStandard>): ContractorPerformanceStandard => ({
  id: "s", code: "X", name: "X", standard_type: "threshold", priority: "High", is_scored: true, unit_label: "percent",
  measurement_source: "manual_entry", ...over,
});
const row = (over: Partial<PeriodKpiAssessment>): PeriodKpiAssessment => ({
  id: "r", period_id: "p", standard_id: "s", code: "X", name: "X", standard_type: "threshold", priority: "High",
  metric_display: "", tier_label: "meets", occurrence_count: 0, proposed_amount: 0, final_amount: null,
  manager_action: "pending", manager_reason: null, data_completeness_pct: 100, ...over,
});
const entry = (over: Partial<ManualMetricEntry>): ManualMetricEntry => ({
  id: "m", standard_id: "s", standard_code: "X", standard_name: "X", contractor_id: "c", contractor_name: "C",
  service_month: "202608", metric_value: 0, source_note: "", entered_by: "rob", entered_at: "2026-09-02T14:00:00Z", ...over,
});

const standards = [
  standard({ id: "roadcalls", code: "AVG_MILES_ROAD_CALLS", unit_label: "miles", measurement_source: "structured_import" }),
  standard({ id: "safety", code: "SAFETY_MEETING" }),
  standard({ id: "otp", code: "OTP_FIXED_ROUTE", measurement_source: "api_feed" }),
  standard({ id: "missed", code: "MISSED_TRIPS_FR", standard_type: "occurrence", unit_label: "occurrences" }),
  standard({ id: "fleet", code: "FLEET_AVAIL_SHORT", is_scored: false }),
];

describe("metricsChecklist", () => {
  it("lists the hand-entered monthly figures the month scores, entered or missing, and the ones it does not score", () => {
    const rows = [row({ id: "r1", standard_id: "roadcalls" }), row({ id: "r2", standard_id: "safety", assessment_outcome: "not_assessable" }), row({ id: "r3", standard_id: "otp" }), row({ id: "r4", standard_id: "missed", standard_type: "occurrence" })];
    const metrics = [entry({ id: "m1", standard_id: "roadcalls", metric_value: 6820, source_note: "Fleet report" })];
    const list = metricsChecklist(rows, standards, metrics);
    expect(list.scored.map((item) => [item.standard.id, item.entry?.metric_value ?? null])).toEqual([["safety", null], ["roadcalls", 6820]]);
    expect(list.unscored.map((item) => item.id)).toEqual(["fleet"]);
    expect(list.entered).toBe(1);
  });
  it("lists as not scored only the hand-entered standards the Agreement assigns, when the assignments are known", () => {
    const rows = [row({ id: "r1", standard_id: "roadcalls" })];
    expect(metricsChecklist(rows, standards, [], new Set(["roadcalls", "safety"])).unscored.map((item) => item.id)).toEqual(["safety"]);
    expect(metricsChecklist(rows, standards, []).unscored.map((item) => item.id)).toEqual(["safety", "fleet"]);
  });
  it("puts the missing figures first so the reader sees what is left", () => {
    const rows = [row({ id: "r1", standard_id: "roadcalls" }), row({ id: "r2", standard_id: "safety" })];
    const metrics = [entry({ standard_id: "roadcalls" })];
    expect(metricsChecklist(rows, standards, metrics).scored.map((item) => item.standard.id)).toEqual(["safety", "roadcalls"]);
  });
  it("before the first compute, reads the catalog's scored flag instead of the period's rows", () => {
    const list = metricsChecklist([], standards, [entry({ standard_id: "safety", metric_value: 92 })]);
    expect(list.scored.map((item) => [item.standard.id, item.entry?.metric_value ?? null])).toEqual([["roadcalls", null], ["safety", 92]]);
    expect(list.unscored.map((item) => item.id)).toEqual(["fleet"]);
  });
});
