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
