import type { Transaction } from "mssql";
import { sql } from "../db";
import { escalationMultiplier } from "./escalation";
import { assessmentInputHash, canonicalJson } from "./hash";
import { computePenalty } from "./penalty";
import { matchTier } from "./tiers";
import { splitAssessmentInput } from "./input";
import type { StandardDirection, StandardTier, TierLabel } from "./types";

interface PeriodRow { id: string; contractor_id: string; service_month: string; input_revision: number; status: string }
interface StandardRow { id: string; code: string; standard_type: "occurrence" | "threshold"; direction: StandardDirection; is_safety_critical: boolean; measurement_source: string }
interface TierRow { tier_order: number; tier_label: TierLabel; bound_low: number | null; bound_high: number | null; qualifier_code: string | null; penalty_basis: StandardTier["penaltyBasis"]; penalty_amount: number; triggers_cap: boolean }

function mapTier(row: TierRow): StandardTier {
  return { tierOrder: row.tier_order, tierLabel: row.tier_label, boundLow: row.bound_low, boundHigh: row.bound_high, qualifierCode: row.qualifier_code, penaltyBasis: row.penalty_basis, penaltyAmount: Number(row.penalty_amount), triggersCap: row.triggers_cap };
}

function severity(label: TierLabel): number {
  return { meets: 0, warning: 1, tier1: 2, tier2: 3 }[label];
}

async function resolveThreshold(tx: Transaction, standard: StandardRow, contractorId: string, month: string) {
  if (standard.code === "OTP_FIXED_ROUTE") {
    const request = new sql.Request(tx);
    request.input("month", sql.Char(6), month);
    const result = await request.query<{ raw_total: number; raw_ontime: number; total: number; ontime: number }>(`
      SELECT
        SUM(ISNULL(otp.total,0)) raw_total,
        SUM(ISNULL(otp.ontime,0)) raw_ontime,
        SUM(CASE WHEN exclusion.id IS NULL THEN ISNULL(otp.total,0) ELSE 0 END) total,
        SUM(CASE WHEN exclusion.id IS NULL THEN ISNULL(otp.ontime,0) ELSE 0 END) ontime
      FROM OtpMonthlyRouteStopDay otp
      LEFT JOIN RouteClassification classification ON classification.route_id=CONVERT(NVARCHAR(50),otp.route_id)
      LEFT JOIN OtpStopExclusions exclusion ON exclusion.service_month=otp.service_month
       AND exclusion.route_id=otp.route_id AND exclusion.stop_id=otp.stop_id
       AND exclusion.day_of_week=otp.day_of_week AND exclusion.status='approved'
      WHERE otp.service_month=@month AND ISNULL(classification.route_category,'FixedRoute')='FixedRoute'
    `);
    const rawTotal = Number(result.recordset[0]?.raw_total ?? 0);
    const rawOntime = Number(result.recordset[0]?.raw_ontime ?? 0);
    const total = Number(result.recordset[0]?.total ?? 0);
    const ontime = Number(result.recordset[0]?.ontime ?? 0);
    return { metricValue: total > 0 ? ontime / total : null, rawMetricValue: rawTotal > 0 ? rawOntime / rawTotal : null, excludedMetricValue: rawTotal - total > 0 ? (rawOntime - ontime) / (rawTotal - total) : null, rawQuantity: rawTotal, excludedQuantity: rawTotal - total, quantity: 1, occurrenceCount: 0, completeness: total > 0 ? 100 : 0, sourceRefs: [`OtpMonthlyRouteStopDay:${month}`] };
  }
  const request = new sql.Request(tx);
  request.input("standard_id", sql.UniqueIdentifier, standard.id);
  request.input("contractor", sql.UniqueIdentifier, contractorId);
  request.input("month", sql.Char(6), month);
  const result = await request.query<{ metric_value: number; unit_count: number | null; id: string }>(`
    SELECT TOP 1 metric_value, unit_count, id FROM ManualMetricEntries
    WHERE standard_id=@standard_id AND contractor_id=@contractor AND service_month=@month AND superseded_by IS NULL
    ORDER BY entered_at DESC
  `);
  const row = result.recordset[0];
  const value = row ? Number(row.metric_value) : null;
  const quantity = Number(row?.unit_count ?? row?.metric_value ?? 0);
  return { metricValue: value, rawMetricValue: value, excludedMetricValue: null, rawQuantity: quantity, excludedQuantity: 0, quantity, occurrenceCount: Number(row?.unit_count ?? 0), completeness: row ? 100 : 0, sourceRefs: row ? [`ManualMetricEntries:${row.id}`] : [] };
}

export async function assessPeriod(tx: Transaction, periodId: string): Promise<void> {
  const periodReq = new sql.Request(tx);
  periodReq.input("period_id", sql.UniqueIdentifier, periodId);
  const periodResult = await periodReq.query<PeriodRow>(`SELECT * FROM AssessmentPeriods WITH (UPDLOCK,HOLDLOCK) WHERE id=@period_id`);
  const period = periodResult.recordset[0];
  if (!period) throw new Error("Assessment period not found");
  if (period.status === "finalized") throw new Error("Finalized periods must be reopened before recompute");

  const standardsReq = new sql.Request(tx); standardsReq.input("period_id",sql.UniqueIdentifier,period.id);
  const standards = await standardsReq.query<StandardRow>(`SELECT standard_id id,code,standard_type,direction,is_safety_critical,measurement_source FROM AssessmentPeriodStandards WHERE period_id=@period_id ORDER BY sort_order`);
  for (const standard of standards.recordset) {
    const tierReq = new sql.Request(tx);
    tierReq.input("standard_id", sql.UniqueIdentifier, standard.id);
    tierReq.input("period_id", sql.UniqueIdentifier, period.id);
    const tierRows = await tierReq.query<TierRow>(`SELECT tier_order,tier_label,bound_low,bound_high,qualifier_code,penalty_basis,penalty_amount,triggers_cap FROM AssessmentPeriodTiers WHERE period_id=@period_id AND standard_id=@standard_id ORDER BY tier_order`);
    const tiers = tierRows.recordset.map(mapTier);
    let metricValue: number | null = null;
    let quantity = 0;
    let occurrenceCount = 0;
    let completeness = 100;
    let sourceRefs: string[] = [];
    let rawMetricValue: number | null = null;
    let rawOccurrenceCount = 0;
    let rawUnitQuantity = 0;
    let excludedMetricValue: number | null = null;
    let excludedOccurrenceCount = 0;
    let excludedUnitQuantity = 0;
    let excludedSourceRefs: string[] = [];
    let baseAmount = 0;
    let capRequired = false;
    let tierLabel: TierLabel = "meets";

    if (standard.standard_type === "occurrence") {
      const occurrencesReq = new sql.Request(tx);
      occurrencesReq.input("standard_id", sql.UniqueIdentifier, standard.id);
      occurrencesReq.input("contractor", sql.UniqueIdentifier, period.contractor_id);
      occurrencesReq.input("month", sql.Char(6), period.service_month);
      const occurrences = await occurrencesReq.query<{ id: string; quantity: number; duration_days: number | null; qualifier_code: string | null; excluded: boolean }>(`
        SELECT o.id,o.quantity,o.duration_days,o.qualifier_code,
          CONVERT(bit,CASE WHEN o.attribution<>'contractor_error' OR c.status='approved' THEN 1 ELSE 0 END) excluded
        FROM ComplianceOccurrences o LEFT JOIN ExcusableDelayClaims c ON c.id=o.relief_id
        WHERE o.standard_id=@standard_id AND o.contractor_id=@contractor AND o.service_month=@month AND o.review_status='confirmed'
      `);
      const input = splitAssessmentInput(occurrences.recordset);
      rawOccurrenceCount = input.rawCount;
      rawUnitQuantity = input.rawQuantity;
      rawMetricValue = input.rawQuantity;
      excludedOccurrenceCount = input.excludedCount;
      excludedUnitQuantity = input.excludedQuantity;
      excludedMetricValue = input.excludedQuantity;
      excludedSourceRefs = input.excludedIds.map(id => `ComplianceOccurrences:${id}`);
      occurrenceCount = input.assessableCount;
      quantity = input.assessableQuantity;
      metricValue = quantity;
      sourceRefs = input.assessableIds.map(id => `ComplianceOccurrences:${id}`);
      for (const row of occurrences.recordset.filter(row => !row.excluded)) {
        const tier = matchTier(tiers, row.quantity, standard.direction, row.qualifier_code);
        if (!tier) continue;
        baseAmount += computePenalty(tier, { quantity: row.quantity, durationDays: row.duration_days ?? 1 });
        capRequired ||= Boolean(tier.triggersCap);
        if (severity(tier.tierLabel) > severity(tierLabel)) tierLabel = tier.tierLabel;
      }
      if (occurrenceCount > 0 && tierLabel === "meets") tierLabel = "tier1";
    } else {
      const resolved = await resolveThreshold(tx, standard, period.contractor_id, period.service_month);
      metricValue = resolved.metricValue; quantity = resolved.quantity; occurrenceCount = resolved.occurrenceCount;
      rawMetricValue = resolved.rawMetricValue; rawUnitQuantity = resolved.rawQuantity; rawMetricValue ??= metricValue;
      excludedMetricValue = resolved.excludedMetricValue; excludedUnitQuantity = resolved.excludedQuantity;
      completeness = resolved.completeness; sourceRefs = resolved.sourceRefs;
      if (metricValue !== null) {
        const tier = matchTier(tiers, metricValue, standard.direction);
        if (tier) { tierLabel = tier.tierLabel; baseAmount = computePenalty(tier, { quantity }); capRequired = Boolean(tier.triggersCap); }
      }
    }

    const historyReq = new sql.Request(tx);
    historyReq.input("standard_id", sql.UniqueIdentifier, standard.id);
    historyReq.input("contractor", sql.UniqueIdentifier, period.contractor_id);
    historyReq.input("month", sql.Char(6), period.service_month);
    const history = await historyReq.query<{ tier_label: TierLabel; assessment_outcome: string | null }>(`
        SELECT pka.tier_label,pka.assessment_outcome FROM PeriodKpiAssessments pka
        JOIN AssessmentPeriods p ON p.id=pka.period_id
        WHERE pka.standard_id=@standard_id AND p.contractor_id=@contractor AND p.service_month<@month AND p.status IN('finalized','issued')
        ORDER BY p.service_month DESC
    `);
    let priorConsecutive = 0;
    for (const row of history.recordset) { if ((row.assessment_outcome??row.tier_label) === "meets") break; if (row.assessment_outcome!=="not_assessable"&&priorConsecutive<2) priorConsecutive += 1; }
    const notAssessable = completeness <= 0;
    const consecutive = notAssessable ? priorConsecutive : tierLabel === "meets" ? 0 : priorConsecutive + 1;
    const escalation = escalationMultiplier(consecutive);
    const proposed = notAssessable ? 0 : Math.max(0, baseAmount) * escalation;
    const outcome = notAssessable ? "not_assessable" : tierLabel;
    const snapshot = { standardCode: standard.code, metricValue, quantity, occurrenceCount, sourceRefs, rawMetricValue, rawOccurrenceCount, rawUnitQuantity, excludedMetricValue, excludedOccurrenceCount, excludedUnitQuantity, excludedSourceRefs, baseAmount, escalation, proposed, tierLabel, outcome };
    const computationJson = canonicalJson(snapshot);
    const inputHash = assessmentInputHash(snapshot);
    const upsert = new sql.Request(tx);
    upsert.input("period_id", sql.UniqueIdentifier, period.id); upsert.input("standard_id", sql.UniqueIdentifier, standard.id);
    upsert.input("metric", sql.Float, metricValue); upsert.input("display", sql.NVarChar(50), metricValue === null ? "No data" : String(metricValue));
    upsert.input("count", sql.Int, occurrenceCount); upsert.input("quantity", sql.Float, quantity); upsert.input("tier", sql.NVarChar(20), tierLabel);
    upsert.input("raw_metric", sql.Float, rawMetricValue); upsert.input("raw_count", sql.Int, rawOccurrenceCount); upsert.input("raw_quantity", sql.Float, rawUnitQuantity);
    upsert.input("excluded_metric", sql.Float, excludedMetricValue); upsert.input("excluded_count", sql.Int, excludedOccurrenceCount); upsert.input("excluded_quantity", sql.Float, excludedUnitQuantity); upsert.input("excluded_refs", sql.NVarChar(sql.MAX), JSON.stringify(excludedSourceRefs));
    upsert.input("base", sql.Decimal(12,2), baseAmount); upsert.input("escalation", sql.Decimal(4,2), escalation);
    upsert.input("proposed", sql.Decimal(12,2), proposed); upsert.input("hash", sql.Char(64), inputHash); upsert.input("json", sql.NVarChar(sql.MAX), computationJson);
    upsert.input("consecutive", sql.Int, consecutive); upsert.input("completeness", sql.Float, completeness);
    upsert.input("outcome", sql.NVarChar(30), outcome);
    upsert.input("cap", sql.Bit, capRequired);
    await upsert.query(`
      MERGE PeriodKpiAssessments WITH (HOLDLOCK) target USING (SELECT @period_id period_id,@standard_id standard_id) source
      ON target.period_id=source.period_id AND target.standard_id=source.standard_id
      WHEN MATCHED THEN UPDATE SET metric_value=@metric,metric_display=@display,occurrence_count=@count,unit_quantity=@quantity,raw_metric_value=@raw_metric,raw_occurrence_count=@raw_count,raw_unit_quantity=@raw_quantity,excluded_metric_value=@excluded_metric,excluded_occurrence_count=@excluded_count,excluded_unit_quantity=@excluded_quantity,excluded_source_refs_json=@excluded_refs,tier_label=@tier,
       target_display=N'Configured tiers',base_amount=@base,escalation_multiplier=@escalation,relief_amount=0,proposed_amount=@proposed,
       manager_action=CASE WHEN target.input_sha256=@hash THEN target.manager_action ELSE 'pending' END,
       final_amount=CASE WHEN target.input_sha256=@hash THEN target.final_amount ELSE NULL END,
       manager_reason=CASE WHEN target.input_sha256=@hash THEN target.manager_reason ELSE NULL END,
       reviewed_input_sha256=CASE WHEN target.input_sha256=@hash THEN target.reviewed_input_sha256 ELSE NULL END,
       reviewed_by=CASE WHEN target.input_sha256=@hash THEN target.reviewed_by ELSE NULL END,
       reviewed_at=CASE WHEN target.input_sha256=@hash THEN target.reviewed_at ELSE NULL END,cap_required=@cap,
       input_sha256=@hash,consecutive_months_below=@consecutive,data_completeness_pct=@completeness,computation_json=@json,assessment_outcome=@outcome
      WHEN NOT MATCHED THEN INSERT(period_id,standard_id,metric_value,metric_display,occurrence_count,unit_quantity,raw_metric_value,raw_occurrence_count,raw_unit_quantity,excluded_metric_value,excluded_occurrence_count,excluded_unit_quantity,excluded_source_refs_json,tier_label,target_display,base_amount,escalation_multiplier,proposed_amount,input_sha256,consecutive_months_below,data_completeness_pct,computation_json,assessment_outcome,cap_required)
       VALUES(@period_id,@standard_id,@metric,@display,@count,@quantity,@raw_metric,@raw_count,@raw_quantity,@excluded_metric,@excluded_count,@excluded_quantity,@excluded_refs,@tier,N'Configured tiers',@base,@escalation,@proposed,@hash,@consecutive,@completeness,@json,@outcome,@cap);
    `);
  }
  const finish = new sql.Request(tx);
  finish.input("period_id", sql.UniqueIdentifier, period.id);
  await finish.query(`UPDATE ValidationDraftShares SET superseded_at=SYSUTCDATETIME() WHERE period_id=@period_id AND superseded_at IS NULL;UPDATE AssessmentPeriods SET computed_revision=input_revision,computed_at=SYSUTCDATETIME(),status='in_review',validation_shared_at=NULL,validation_ends_on=NULL,validation_shared_by=NULL,validation_recipient=NULL,validation_method=NULL,validation_attestation=NULL,proposed_total=(SELECT ISNULL(SUM(proposed_amount),0) FROM PeriodKpiAssessments WHERE period_id=@period_id),is_partial=CASE WHEN EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@period_id AND assessment_outcome='not_assessable') THEN 1 ELSE 0 END WHERE id=@period_id`);
}
