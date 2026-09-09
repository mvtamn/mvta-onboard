import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "mssql";
import { assessPeriod } from "./assessment/assess";
import { sql } from "./db";

// ADR 0011: the Escalation Streak is built from issued outcomes only, one per
// Agreement and month. A finalized-but-unissued month pauses the streak; a
// correction period replaces the original it supersedes rather than counting
// beside it; another Agreement's months are invisible.
const agreementId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const contractorId = "11111111-1111-4111-8111-111111111111";

test("the escalation history reads one issued outcome per Agreement-month", async () => {
  const OriginalRequest = sql.Request;
  let historyQuery = "";
  let historyInputs = new Map<string, unknown>();

  class FakeRequest {
    private readonly inputs = new Map<string, unknown>();
    input(name: string, _type: unknown, value: unknown) { this.inputs.set(name, value); return this; }
    async query<T>(text: string): Promise<{ recordset: T[] }> {
      if (text.includes("FROM AssessmentPeriods WITH")) {
        return { recordset: [{ id: "period", contractor_id: contractorId, agreement_id: agreementId, service_month: "202607", input_revision: 0, status: "open" } as T] };
      }
      if (text.includes("FROM AssessmentPeriodStandards")) {
        return { recordset: [{ id: "otp", code: "OTP_FIXED_ROUTE", standard_type: "threshold", direction: "higher_is_better", is_safety_critical: false, measurement_source: "manual_entry", resolver_key: null, target_value: null, target_display: null, band_scope: null, cap_window_days: null, cap_window_threshold: null, cap_window_mode: null } as T] };
      }
      if (text.includes("FROM PeriodKpiAssessments pka") && text.includes("JOIN AssessmentPeriods p")) {
        historyQuery = text; historyInputs = this.inputs;
        return { recordset: [] };
      }
      return { recordset: [] };
    }
  }

  (sql as unknown as { Request: typeof FakeRequest }).Request = FakeRequest;
  try { await assessPeriod({} as Transaction, "period"); }
  finally { (sql as unknown as { Request: typeof OriginalRequest }).Request = OriginalRequest; }

  assert.ok(historyQuery, "the history query ran");
  assert.equal(historyInputs.get("agreement"), agreementId);
  assert.match(historyQuery, /p\.agreement_id\s*=\s*@agreement/);
  // Issued only: a finalized-but-unissued month contributes nothing.
  assert.match(historyQuery, /p\.status\s*=\s*'issued'/);
  assert.doesNotMatch(historyQuery, /'finalized'/);
  // One row per month: the highest assessment_revision among that month's issued periods.
  assert.match(historyQuery, /MAX\(\w+\.assessment_revision\)/);
});

// The loop over that history: newest first, stop at the first "meets", count
// below-standard months up to two, and let a Not Assessable month pause
// rather than count or break. With the current month also below standard,
// two prior counted months make three, which is where escalation begins.
async function escalationFor(history: Array<{ service_month: string; tier_label: string; assessment_outcome: string | null }>, currentTier: "tier1" | "meets") {
  const OriginalRequest = sql.Request;
  let bound = null as Map<string, unknown> | null;
  class FakeRequest {
    private readonly inputs = new Map<string, unknown>();
    input(name: string, _type: unknown, value: unknown) { this.inputs.set(name, value); return this; }
    async query<T>(text: string): Promise<{ recordset: T[] }> {
      if (text.includes("FROM AssessmentPeriods WITH")) return { recordset: [{ id: "period", contractor_id: contractorId, agreement_id: agreementId, service_month: "202609", input_revision: 0, status: "open" } as T] };
      if (text.includes("FROM AssessmentPeriodStandards")) return { recordset: [{ id: "otp", code: "OTP_FIXED_ROUTE", standard_type: "threshold", direction: "higher_is_better", is_safety_critical: false, measurement_source: "manual_entry", resolver_key: "manual_metric", target_value: null, target_display: null, band_scope: null, cap_window_days: null, cap_window_threshold: null, cap_window_mode: null } as T] };
      if (text.includes("FROM AssessmentPeriodTiers")) return { recordset: [
        { tier_order: 1, tier_label: "meets", bound_low: 0.85, bound_high: null, qualifier_code: null, penalty_basis: "none", penalty_amount: 0, triggers_cap: false, severity_order: null, penalty_amount_min: null, penalty_amount_max: null },
        { tier_order: 2, tier_label: "tier1", bound_low: null, bound_high: 0.85, qualifier_code: null, penalty_basis: "flat", penalty_amount: 1500, triggers_cap: false, severity_order: null, penalty_amount_min: null, penalty_amount_max: null },
      ] as T[] };
      if (text.includes("FROM ManualMetricEntries")) return { recordset: [{ metric_value: currentTier === "meets" ? 0.9 : 0.7, entered_at: new Date("2026-10-01T00:00:00Z") } as T] };
      if (text.includes("FROM PeriodKpiAssessments pka") && text.includes("JOIN AssessmentPeriods p")) return { recordset: history as T[] };
      if (text.includes("MERGE PeriodKpiAssessments")) { bound = this.inputs; return { recordset: [] }; }
      return { recordset: [] };
    }
  }
  (sql as unknown as { Request: typeof FakeRequest }).Request = FakeRequest;
  try { await assessPeriod({} as Transaction, "period"); }
  finally { (sql as unknown as { Request: typeof OriginalRequest }).Request = OriginalRequest; }
  const inputs = bound as Map<string, unknown> | null;
  assert.ok(inputs, "the upsert ran");
  return { consecutive: inputs.get("consecutive"), escalation: inputs.get("escalation") };
}

test("two issued below-standard months plus this one reach the escalation", async () => {
  assert.deepEqual(await escalationFor([
    { service_month: "202608", tier_label: "tier1", assessment_outcome: "tier1" },
    { service_month: "202607", tier_label: "tier2", assessment_outcome: "tier2" },
  ], "tier1"), { consecutive: 3, escalation: 1.5 });
});

test("a Not Assessable month pauses the streak rather than counting or breaking it", async () => {
  assert.deepEqual(await escalationFor([
    { service_month: "202608", tier_label: "tier1", assessment_outcome: "not_assessable" },
    { service_month: "202607", tier_label: "tier1", assessment_outcome: "tier1" },
  ], "tier1"), { consecutive: 2, escalation: 1 });
});

test("an issued month that met the standard ends the streak behind it", async () => {
  assert.deepEqual(await escalationFor([
    { service_month: "202608", tier_label: "meets", assessment_outcome: "meets" },
    { service_month: "202607", tier_label: "tier1", assessment_outcome: "tier1" },
  ], "tier1"), { consecutive: 1, escalation: 1 });
});

test("meeting the standard this month resets the streak to zero", async () => {
  assert.deepEqual(await escalationFor([
    { service_month: "202608", tier_label: "tier1", assessment_outcome: "tier1" },
  ], "meets"), { consecutive: 0, escalation: 1 });
});
