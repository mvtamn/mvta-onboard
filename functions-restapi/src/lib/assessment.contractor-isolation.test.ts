import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "mssql";
import { assessPeriod } from "./assessment/assess";
import { sql } from "./db";

const contractorId = "11111111-1111-4111-8111-111111111111";

test("assessment input queries stay within the selected contractor", async () => {
  const OriginalRequest = sql.Request;

  class FakeRequest {
    private readonly inputs = new Map<string, unknown>();

    input(name: string, _type: unknown, value: unknown) {
      this.inputs.set(name, value);
      return this;
    }

    async query<T>(text: string): Promise<{ recordset: T[] }> {
      if (text.includes("FROM AssessmentPeriods WITH")) {
        return { recordset: [{ id: "period", contractor_id: contractorId, service_month: "202607", ramp_up_stage: "full", input_revision: 0, status: "open" } as T] };
      }
      if (text.includes("FROM ContractorPerformanceStandards")) {
        return { recordset: [
          { id: "occurrence-standard", code: "MISSED_TRIPS_FR", standard_type: "occurrence", direction: "lower_is_better", is_safety_critical: false, measurement_source: "auto" },
          { id: "metric-standard", code: "OPERATOR_CONDUCT", standard_type: "threshold", direction: "lower_is_better", is_safety_critical: false, measurement_source: "manual" },
        ] as T[] };
      }
      if (text.includes("FROM ContractorStandardTiers")) {
        return { recordset: [{ tier_order: 1, tier_label: "meets", bound_low: null, bound_high: null, qualifier_code: null, penalty_basis: "none", penalty_amount: 0, triggers_cap: false } as T] };
      }
      if (text.includes("FROM ComplianceOccurrences")) {
        assert.equal(this.inputs.get("contractor"), contractorId);
        assert.match(text, /contractor_id\s*=\s*@contractor/);
        return { recordset: [] };
      }
      if (text.includes("FROM ManualMetricEntries")) {
        assert.equal(this.inputs.get("contractor"), contractorId);
        assert.match(text, /contractor_id\s*=\s*@contractor/);
        return { recordset: [] };
      }
      if (text.includes("FROM PeriodKpiAssessments") && text.includes("JOIN AssessmentPeriods")) {
        assert.equal(this.inputs.get("contractor"), contractorId);
        assert.match(text, /p\.contractor_id\s*=\s*@contractor/);
        return { recordset: [] };
      }
      return { recordset: [] };
    }
  }

  (sql as unknown as { Request: typeof FakeRequest }).Request = FakeRequest;
  try {
    await assessPeriod({} as Transaction, "period");
  } finally {
    (sql as unknown as { Request: typeof OriginalRequest }).Request = OriginalRequest;
  }
});
