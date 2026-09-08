import type { Transaction } from "mssql";
import { sql } from "../db";
import { escalationMultiplier } from "./escalation";
import { assessmentInputHash, canonicalJson } from "./hash";
import { bandAmount, computePenalty, isRangedBand } from "./penalty";
import { bandMatchValue, matchTier } from "./tiers";
import { splitAssessmentInput } from "./input";
import { tierSeverity } from "./referenceValues";
import { describeCapWindowBreach, findCapWindowBreach } from "./capWindow";
import { agreementScopeIn, periodResolverKeySql, periodStandardScalingSql, periodTierScalingSql } from "./schemaScope";
import { resolveAutomatedThreshold, resolveManualMetric } from "./resolvers";
import { isHandEntered, normalizeMeasurementSource } from "./measurementSource";
import { notMeasurable } from "./resolvers/types";
import type { StandardDirection, StandardTier, TierLabel } from "./types";

interface PeriodRow { id: string; contractor_id: string; service_month: string; input_revision: number; status: string }
interface StandardRow { id: string; code: string; standard_type: "occurrence" | "threshold"; direction: StandardDirection; is_safety_critical: boolean; measurement_source: string; resolver_key: string | null; target_value: number | null; target_display: string | null; band_scope: "per_occurrence" | "running_count" | null; cap_window_days: number | null; cap_window_threshold: number | null; cap_window_mode: "rolling_days" | "calendar_quarter" | null }
interface TierRow { tier_order: number; tier_label: TierLabel; bound_low: number | null; bound_high: number | null; qualifier_code: string | null; penalty_basis: StandardTier["penaltyBasis"]; penalty_amount: number; triggers_cap: boolean; severity_order: number | null; penalty_amount_min: number | null; penalty_amount_max: number | null }

function mapTier(row: TierRow): StandardTier {
  return { tierOrder: row.tier_order, tierLabel: row.tier_label, boundLow: row.bound_low, boundHigh: row.bound_high, qualifierCode: row.qualifier_code, penaltyBasis: row.penalty_basis, penaltyAmount: Number(row.penalty_amount), triggersCap: row.triggers_cap, severityOrder: row.severity_order ?? null, penaltyAmountMin: row.penalty_amount_min ?? null, penaltyAmountMax: row.penalty_amount_max ?? null };
}

// Tier ranking comes from the period's snapshot (migration 105), falling back
// to the pre-105 map. See referenceValues.tierSeverity for why an unknown
// label must rank below everything rather than yielding undefined.
function severity(tier: Pick<StandardTier, "tierLabel" | "severityOrder">): number {
  return tierSeverity(tier.tierLabel, tier.severityOrder);
}

// Measure one threshold standard for the period.
//
// Routed by where the number comes from, normalized because a period
// snapshotted before migration 104 carries the old two-value vocabulary and
// still has to compute to the same answer it was finalized with.
//
// An unregistered or absent resolver does not fall through to hand-entered
// figures. That was the old behaviour and the worst available one: the compute
// found nothing there either, scored the month "no data", and a scorecard
// reading "no data" looks like a quiet month rather than a standard nobody can
// measure.
async function resolveThreshold(tx: Transaction, standard: StandardRow, contractorId: string, month: string) {
  const context = { tx, contractorId, month, standardCode: standard.code };
  const source = normalizeMeasurementSource(standard.measurement_source, standard.standard_type);
  if (isHandEntered(source)) return resolveManualMetric(context, standard.id);
  if (source === "onboard_compliance") {
    // OnBoard raises occurrences, which are rows rather than a monthly figure.
    // A threshold standard declaring this source has no number to read.
    return notMeasurable(`${standard.code} is measured from OnBoard compliance occurrences, which cannot produce a monthly value. Change it to a feed or a hand-entered figure.`);
  }
  return resolveAutomatedThreshold(standard.resolver_key, context);
}

export async function assessPeriod(tx: Transaction, periodId: string): Promise<void> {
  const periodReq = new sql.Request(tx);
  periodReq.input("period_id", sql.UniqueIdentifier, periodId);
  const periodResult = await periodReq.query<PeriodRow>(`SELECT * FROM AssessmentPeriods WITH (UPDLOCK,HOLDLOCK) WHERE id=@period_id`);
  const period = periodResult.recordset[0];
  if (!period) throw new Error("Assessment period not found");
  if (period.status === "finalized") throw new Error("Finalized periods must be reopened before recompute");

  const scope = await agreementScopeIn(tx);
  const standardsReq = new sql.Request(tx); standardsReq.input("period_id",sql.UniqueIdentifier,period.id);
  const standards = await standardsReq.query<StandardRow>(`SELECT standard_id id,code,standard_type,direction,is_safety_critical,measurement_source,${periodResolverKeySql(scope)},${periodStandardScalingSql(scope)} FROM AssessmentPeriodStandards WHERE period_id=@period_id ORDER BY sort_order`);
  for (const standard of standards.recordset) {
    const tierReq = new sql.Request(tx);
    tierReq.input("standard_id", sql.UniqueIdentifier, standard.id);
    tierReq.input("period_id", sql.UniqueIdentifier, period.id);
    const tierRows = await tierReq.query<TierRow>(`SELECT tier_order,tier_label,bound_low,bound_high,qualifier_code,penalty_basis,penalty_amount,triggers_cap,severity_order,${periodTierScalingSql(scope)} FROM AssessmentPeriodTiers WHERE period_id=@period_id AND standard_id=@standard_id ORDER BY tier_order`);
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
    let worstSeverity: number | null = null;
    // Occurrences on a ranged band with no reviewer figure yet.
    let awaitingAmountCount = 0;
    let capWindowReason: string | null = null;
    // Why a standard could not be measured, when that is a fact worth
    // reporting rather than simply an empty month.
    let unresolvedReason: string | null = null;
    let tierLabel: TierLabel = "meets";

    if (standard.standard_type === "occurrence") {
      const occurrencesReq = new sql.Request(tx);
      occurrencesReq.input("standard_id", sql.UniqueIdentifier, standard.id);
      occurrencesReq.input("contractor", sql.UniqueIdentifier, period.contractor_id);
      occurrencesReq.input("month", sql.Char(6), period.service_month);
      const occurrences = await occurrencesReq.query<{ id: string; quantity: number; duration_days: number | null; qualifier_code: string | null; excluded: boolean; service_date: string; assessed_amount: number | null }>(`
        SELECT o.id,o.quantity,o.duration_days,o.qualifier_code,o.service_date,
          ${scope.penaltyScaling ? "o.assessed_amount" : "CONVERT(decimal(12,2),NULL) assessed_amount"},
          CONVERT(bit,CASE WHEN o.attribution<>'contractor_error' OR c.status='approved' THEN 1 ELSE 0 END) excluded
        FROM ComplianceOccurrences o LEFT JOIN ExcusableDelayClaims c ON c.id=o.relief_id
        WHERE o.standard_id=@standard_id AND o.contractor_id=@contractor AND o.service_month=@month AND o.review_status='confirmed'
        ORDER BY o.service_date, o.created_at, o.id
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
      // Ordinal position drives a count-scaled band ("the thirteenth and each
      // after it"), so the assessable occurrences are walked in date order.
      const assessable = occurrences.recordset.filter(row => !row.excluded);
      const bandScope = standard.band_scope === "running_count" ? "running_count" : "per_occurrence";
      let ordinal = 0;
      for (const row of assessable) {
        ordinal += Math.max(1, Math.round(row.quantity || 1));
        const tier = matchTier(tiers, bandMatchValue(bandScope, row.quantity, ordinal), standard.direction, row.qualifier_code);
        if (!tier) continue;
        // A ranged band waits on a reviewer's figure. Counting it rather than
        // scoring it zero is what keeps a $0 line off a report where the
        // contract says an amount between two bounds is owed.
        if (isRangedBand(tier) && bandAmount(tier, row.assessed_amount) === null) {
          awaitingAmountCount += 1;
        } else {
          baseAmount += computePenalty(tier, { quantity: row.quantity, durationDays: row.duration_days ?? 1, assessedAmount: row.assessed_amount });
        }
        capRequired ||= Boolean(tier.triggersCap);
        if (severity(tier) > severity({ tierLabel, severityOrder: worstSeverity })) { tierLabel = tier.tierLabel; worstSeverity = tier.severityOrder ?? null; }
      }

      // A rolling window crosses month boundaries, so it is evaluated over the
      // occurrences leading up to this period as well as those inside it -
      // five collisions spread over two months breach a 30-day rule that
      // neither month breaches alone.
      const windowMode = standard.cap_window_mode ?? "rolling_days";
      if (standard.cap_window_threshold && (windowMode === "calendar_quarter" || standard.cap_window_days)) {
        const windowReq = new sql.Request(tx);
        windowReq.input("standard_id", sql.UniqueIdentifier, standard.id);
        windowReq.input("contractor", sql.UniqueIdentifier, period.contractor_id);
        windowReq.input("month", sql.Char(6), period.service_month);
        windowReq.input("days", sql.Int, standard.cap_window_days ?? 0);
        windowReq.input("mode", sql.NVarChar(20), windowMode);
        const windowRows = await windowReq.query<{ service_date: string; quantity: number }>(`
          SELECT o.service_date, o.quantity FROM ComplianceOccurrences o
          LEFT JOIN ExcusableDelayClaims c ON c.id=o.relief_id
          WHERE o.standard_id=@standard_id AND o.contractor_id=@contractor
            AND o.review_status='confirmed'
            AND o.attribution='contractor_error' AND (c.id IS NULL OR c.status<>'approved')
            AND o.service_date <= CONCAT(@month,'31')
            -- A rolling window reaches back its own length before the month;
            -- a calendar quarter reaches back to the first day of the quarter
            -- this month falls in, which is where its count starts.
            AND CONVERT(date,o.service_date,112) >= CASE WHEN @mode = 'calendar_quarter'
                  THEN DATEADD(quarter, DATEDIFF(quarter, 0, CONVERT(date, CONCAT(@month,'01'), 112)), 0)
                  ELSE DATEADD(day, -(@days), CONVERT(date, CONCAT(@month,'01'), 112)) END
          ORDER BY o.service_date
        `);
        const rule = { mode: windowMode, windowDays: standard.cap_window_days ?? undefined, threshold: standard.cap_window_threshold };
        const breach = findCapWindowBreach(
          windowRows.recordset.map(row => ({ serviceDate: row.service_date, quantity: row.quantity })), rule);
        if (breach) {
          capRequired = true;
          capWindowReason = describeCapWindowBreach(breach, rule);
        }
      }
      if (occurrenceCount > 0 && tierLabel === "meets") tierLabel = "tier1";
    } else {
      const resolved = await resolveThreshold(tx, standard, period.contractor_id, period.service_month);
      unresolvedReason = resolved.unresolvedReason ?? null;
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
    const snapshot = { standardCode: standard.code, resolverKey: standard.resolver_key ?? null, unresolvedReason, awaitingAmountCount, capWindowReason, targetValue: standard.target_value ?? null, metricValue, quantity, occurrenceCount, sourceRefs, rawMetricValue, rawOccurrenceCount, rawUnitQuantity, excludedMetricValue, excludedOccurrenceCount, excludedUnitQuantity, excludedSourceRefs, baseAmount, escalation, proposed, tierLabel, outcome };
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
    upsert.input("target_display", sql.NVarChar(100), standard.target_display ?? (standard.target_value !== null ? String(standard.target_value) : "Configured bands"));
    upsert.input("awaiting", sql.Int, awaitingAmountCount);
    await upsert.query(`
      MERGE PeriodKpiAssessments WITH (HOLDLOCK) target USING (SELECT @period_id period_id,@standard_id standard_id) source
      ON target.period_id=source.period_id AND target.standard_id=source.standard_id
      WHEN MATCHED THEN UPDATE SET metric_value=@metric,metric_display=@display,occurrence_count=@count,unit_quantity=@quantity,raw_metric_value=@raw_metric,raw_occurrence_count=@raw_count,raw_unit_quantity=@raw_quantity,excluded_metric_value=@excluded_metric,excluded_occurrence_count=@excluded_count,excluded_unit_quantity=@excluded_quantity,excluded_source_refs_json=@excluded_refs,tier_label=@tier,
       target_display=@target_display,base_amount=@base,escalation_multiplier=@escalation,relief_amount=0,proposed_amount=@proposed,
       manager_action=CASE WHEN target.input_sha256=@hash THEN target.manager_action ELSE 'pending' END,
       final_amount=CASE WHEN target.input_sha256=@hash THEN target.final_amount ELSE NULL END,
       manager_reason=CASE WHEN target.input_sha256=@hash THEN target.manager_reason ELSE NULL END,
       reviewed_input_sha256=CASE WHEN target.input_sha256=@hash THEN target.reviewed_input_sha256 ELSE NULL END,
       reviewed_by=CASE WHEN target.input_sha256=@hash THEN target.reviewed_by ELSE NULL END,
       reviewed_at=CASE WHEN target.input_sha256=@hash THEN target.reviewed_at ELSE NULL END,cap_required=@cap,awaiting_amount_count=@awaiting,
       input_sha256=@hash,consecutive_months_below=@consecutive,data_completeness_pct=@completeness,computation_json=@json,assessment_outcome=@outcome
      WHEN NOT MATCHED THEN INSERT(period_id,standard_id,metric_value,metric_display,occurrence_count,unit_quantity,raw_metric_value,raw_occurrence_count,raw_unit_quantity,excluded_metric_value,excluded_occurrence_count,excluded_unit_quantity,excluded_source_refs_json,tier_label,target_display,base_amount,escalation_multiplier,proposed_amount,input_sha256,consecutive_months_below,data_completeness_pct,computation_json,assessment_outcome,cap_required,awaiting_amount_count)
       VALUES(@period_id,@standard_id,@metric,@display,@count,@quantity,@raw_metric,@raw_count,@raw_quantity,@excluded_metric,@excluded_count,@excluded_quantity,@excluded_refs,@tier,@target_display,@base,@escalation,@proposed,@hash,@consecutive,@completeness,@json,@outcome,@cap,@awaiting);
    `);
  }
  const finish = new sql.Request(tx);
  finish.input("period_id", sql.UniqueIdentifier, period.id);
  await finish.query(`UPDATE ValidationDraftShares SET superseded_at=SYSUTCDATETIME() WHERE period_id=@period_id AND superseded_at IS NULL;UPDATE AssessmentPeriods SET computed_revision=input_revision,computed_at=SYSUTCDATETIME(),status='in_review',validation_shared_at=NULL,validation_ends_on=NULL,validation_shared_by=NULL,validation_recipient=NULL,validation_method=NULL,validation_attestation=NULL,proposed_total=(SELECT ISNULL(SUM(proposed_amount),0) FROM PeriodKpiAssessments WHERE period_id=@period_id),is_partial=CASE WHEN EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@period_id AND assessment_outcome='not_assessable') THEN 1 ELSE 0 END WHERE id=@period_id`);
}
