import { sql } from "../../db";
import { ratioWorking } from "../display";
import type { ResolvedMeasurement, ResolverContext } from "./types";

// The current hand-entered figure for a standard nothing measures for us.
//
// Six of the nine scored standards are here - Nexus and Asset Works M5 are not
// integrated - so this is the common path, not the fallback. A superseded
// entry is ignored; the newest live one wins.
export async function resolveManualMetric(context: ResolverContext, standardId: string): Promise<ResolvedMeasurement> {
  const request = new sql.Request(context.tx);
  request.input("standard_id", sql.UniqueIdentifier, standardId);
  request.input("contractor", sql.UniqueIdentifier, context.contractorId);
  request.input("month", sql.Char(6), context.month);
  const result = await request.query<{ metric_value: number; unit_count: number | null; numerator: number | null; denominator: number | null; id: string }>(`
    SELECT TOP 1 metric_value, unit_count, numerator, denominator, id FROM ManualMetricEntries
    WHERE standard_id=@standard_id AND contractor_id=@contractor AND service_month=@month AND superseded_by IS NULL
    ORDER BY entered_at DESC
  `);
  const row = result.recordset[0];
  if (!row) {
    return {
      metricValue: null, rawMetricValue: null, excludedMetricValue: null,
      rawQuantity: 0, excludedQuantity: 0, quantity: 0, occurrenceCount: 0,
      completeness: 0, sourceRefs: [],
      // Named so the period's exception list distinguishes "nobody entered it"
      // from "the feed that measures it is misconfigured".
      unresolvedReason: "No monthly figure has been entered for this standard.",
    };
  }
  const value = Number(row.metric_value);
  const quantity = Number(row.unit_count ?? row.metric_value ?? 0);
  // A ratio standard's entry carries the two quantities it was divided from
  // (v1.5.182); the report shows them under the figure. Older entries, and
  // standards typed whole, carry none.
  const working = ratioWorking(context.standardCode, row.numerator, row.denominator);
  return {
    metricValue: value, rawMetricValue: value, excludedMetricValue: null,
    rawQuantity: quantity, excludedQuantity: 0, quantity,
    occurrenceCount: Number(row.unit_count ?? 0), completeness: 100,
    sourceRefs: [`ManualMetricEntries:${row.id}`],
    ...(working ? { working } : {}),
  };
}
