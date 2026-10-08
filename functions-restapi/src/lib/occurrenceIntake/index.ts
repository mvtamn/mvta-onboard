// The occurrence intake module. It is the only writer of ComplianceOccurrences:
//
//   raiseCandidates    - the nightly pass: source observations become
//                        candidates, each judged by the intake rule.
//   recordOccurrence   - one observation or review answer, written now.
//   resolveOccurrence  - a reviewer's status, attribution and relief link.
//   setAssessedAmount  - a reviewer's figure on a ranged penalty.
//
// Every path assigns the contractor from the Agreement covering the service
// date (assignment.ts), refuses a finalized or issued month, and tells the
// month its input changed through the shared rule in assessment/materialChange.
// Source references are built and read in sources.ts only.
import { assessableInputChangedSql } from "../assessment/materialChange";
import { sql } from "../db";
import { missedTripCaseSql } from "../missedTripCase/classify";
import { detectorPromotionWindows, type PromotionWindow } from "../missedTripCase/promotion";
import { INTAKE_READY_SQL, occurrenceAssignmentSql } from "./assignment";
import { decideAmount, decideChange, decideManual, decideNew, refusal } from "./decide";
import {
  garageDepartureCandidatePredicate,
  occurrenceSourceRefSql,
  onDemandDepartureCandidatePredicate,
} from "./sources";
import type {
  AssessedAmount,
  CandidateSource,
  IntakeOutcome,
  IntakeState,
  RaiseGates,
  RaiseReport,
  RecordObservation,
  Resolution,
  Written,
} from "./types";

export * from "./types";
export * from "./sources";
export { occurrenceAssignmentSql } from "./assignment";
export { occurrenceStateFor, REFUSAL_SENTENCES } from "./decide";

type Executor = sql.ConnectionPool | sql.Transaction;
const request = (executor: Executor) => executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

async function schemaReady(executor: Executor): Promise<boolean> {
  return (await request(executor).query<{ ready: number }>(INTAKE_READY_SQL)).recordset[0]?.ready === 1;
}

async function markInputChanged(tx: sql.Transaction, contractorId: string, serviceMonth: string, actor: string): Promise<void> {
  await new sql.Request(tx)
    .input("contractor", sql.UniqueIdentifier, contractorId)
    .input("month", sql.Char(6), serviceMonth)
    .input("actor", sql.NVarChar(200), actor)
    .query(assessableInputChangedSql("contractor", "month", "actor"));
}

// ---------------------------------------------------------------------------
// raiseCandidates

// Each source's observations, as rows of (standard_id, service_date,
// description, source_ref). Eligibility lives in sources.ts; gating (feed
// trust) is the caller's.
const CANDIDATE_ROWS: Record<CandidateSource, (promoted: readonly PromotionWindow[]) => string> = {
  // Only a detector out of Shadow detection raises a candidate, and only for
  // the service dates it was promoted for (missedTripCase/promotion.ts).
  missed_trips: (promoted) => `
    SELECT standard.id standard_id, LEFT(m.service_date,8) service_date,
      CONCAT(N'Missed trip ',m.trip_id,N' on route ',m.route_id) description,
      ${occurrenceSourceRefSql("missed_trip", "m")} source_ref
    FROM MonitoredMissedTrips m ${missedTripCaseSql("m", "mtc", promoted)} CROSS JOIN ContractorPerformanceStandards standard
    WHERE standard.code='MISSED_TRIPS_FR' AND mtc.counts_toward_assessment=1
      AND ((ISNULL(m.source_system,N'gtfs')=N'spare' AND @allow_spare_missed_trips=1)
        OR (ISNULL(m.source_system,N'gtfs')<>N'spare' AND @allow_fixed_missed_trips=1))`,
  fixed_route_departures: () => `
    SELECT standard.id standard_id, d.service_date,
      CONCAT(N'Garage departure ',d.pullout_status,N' — block ',d.block,N', run ',d.run,N' — ',
        CASE WHEN d.pullout_actual IS NULL THEN N'no departure recorded'
          ELSE CONCAT(N'departed ',DATEDIFF(MINUTE,d.pullout_scheduled,d.pullout_actual),N' min late') END) description,
      ${occurrenceSourceRefSql("fixed_route_departure", "d")} source_ref
    FROM FixedRouteDepartures d CROSS JOIN ContractorPerformanceStandards standard
    WHERE standard.code='GARAGE_DEPARTURE' AND ${garageDepartureCandidatePredicate()}`,
  on_demand_departures: () => `
    SELECT standard.id standard_id, d.service_date,
      CONCAT(N'Garage departure — on-demand duty ',ISNULL(d.duty_identifier,d.duty_id),N' — ',
        CASE WHEN d.departure_actual IS NULL THEN N'no departure recorded'
          ELSE CONCAT(N'departed ',DATEDIFF(MINUTE,d.departure_scheduled,d.departure_actual),N' min late') END,
        CASE d.departure_source WHEN N'slots_startLocation' THEN N' (start slot)'
          WHEN N'duties_firstSeenInServiceArea' THEN N' (first seen in service area)' ELSE N'' END,
        CASE d.scheduled_source WHEN N'duties_startRequested' THEN N'; schedule from the duty''s requested start' ELSE N'' END) description,
      ${occurrenceSourceRefSql("on_demand_departure", "d")} source_ref
    FROM OnDemandDepartures d CROSS JOIN ContractorPerformanceStandards standard
    WHERE standard.code='GARAGE_DEPARTURE' AND ${onDemandDepartureCandidatePredicate()}`,
};

export interface RaiseParameters {
  gates: RaiseGates;
  // The poll's missed-trip gates are per source system.
  allowFixedMissedTrips: boolean;
  allowSpareMissedTrips: boolean;
  varianceSeconds: number;
  settledBefore: string;
}

export type RaiseResult = Record<CandidateSource, RaiseReport | { skipped: true } | { failed: unknown }>;

// One transaction per source, so a failing source does not hold back the
// others. An observation intake refuses is counted, not written, and is judged
// again next pass: an Agreement created later picks it up.
export async function raiseCandidates(pool: sql.ConnectionPool, params: RaiseParameters): Promise<RaiseResult> {
  const result = {} as RaiseResult;
  const ready = await schemaReady(pool);
  const promoted = await detectorPromotionWindows(pool);
  for (const source of Object.keys(CANDIDATE_ROWS) as CandidateSource[]) {
    if (!ready || !params.gates[source]) { result[source] = { skipped: true }; continue; }
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const raise = new sql.Request(tx)
        .input("allow_fixed_missed_trips", sql.Bit, params.allowFixedMissedTrips ? 1 : 0)
        .input("allow_spare_missed_trips", sql.Bit, params.allowSpareMissedTrips ? 1 : 0)
        .input("variance_seconds", sql.Int, params.varianceSeconds)
        .input("settled_before", sql.Char(8), params.settledBefore);
      const written = await raise.query<{ intake: IntakeState; n: number }>(`
        DECLARE @judged TABLE(standard_id UNIQUEIDENTIFIER, service_date CHAR(8), description NVARCHAR(2000), source_ref NVARCHAR(300), contractor_id UNIQUEIDENTIFIER, intake NVARCHAR(30));
        INSERT @judged
        SELECT o.standard_id, o.service_date, o.description, o.source_ref, x.contractor_id, x.intake
        FROM (${CANDIDATE_ROWS[source](promoted)}) o
        ${occurrenceAssignmentSql("o.service_date", "o.standard_id", "x")}
        WHERE NOT EXISTS(SELECT 1 FROM ComplianceOccurrences existing WITH (UPDLOCK, HOLDLOCK) WHERE existing.source_ref=o.source_ref);

        INSERT ComplianceOccurrences(standard_id,contractor_id,service_date,quantity,description,source,source_ref,review_status,attribution,created_by)
        SELECT standard_id,contractor_id,service_date,1,description,'auto_candidate',source_ref,'candidate','undetermined','complianceCandidatesPoll'
        FROM @judged WHERE intake='accepted';

        SELECT intake, COUNT(*) n FROM @judged GROUP BY intake;
        SELECT DISTINCT CONVERT(CHAR(36), contractor_id) contractor_id, LEFT(service_date,6) service_month FROM @judged WHERE intake='accepted';
      `);
      const sets = written.recordsets as unknown as [{ intake: IntakeState; n: number }[], { contractor_id: string; service_month: string }[]];
      const count = (state: IntakeState) => sets[0].find((row) => row.intake === state)?.n ?? 0;
      for (const month of sets[1]) await markInputChanged(tx, month.contractor_id, month.service_month, "complianceCandidatesPoll");
      await tx.commit();
      result[source] = { raised: count("accepted"), unassigned: count("unassigned"), not_scored: count("standard_not_scored"), period_closed: count("period_closed") };
    } catch (error) {
      try { await tx.rollback(); } catch { /* already ended */ }
      result[source] = { failed: error };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// recordOccurrence

export async function recordOccurrence(tx: sql.Transaction, observation: RecordObservation, actor: string): Promise<IntakeOutcome> {
  if (!(await schemaReady(tx))) return { ok: false, refusal: refusal("schema_not_ready") };
  return observation.kind === "manual"
    ? recordManual(tx, observation, actor)
    : recordMissedTripReview(tx, observation, actor);
}

async function recordManual(tx: sql.Transaction, o: Extract<RecordObservation, { kind: "manual" }>, actor: string): Promise<IntakeOutcome> {
  const facts = (await new sql.Request(tx)
    .input("standard", sql.UniqueIdentifier, o.standardId)
    .input("date", sql.Char(8), o.serviceDate)
    .query<{ intake: IntakeState; contractor_id: string | null }>(`
      SELECT x.intake, x.contractor_id FROM ContractorPerformanceStandards s
      ${occurrenceAssignmentSql("@date", "s.id", "x")}
      WHERE s.id=@standard`)).recordset[0];
  const refused = decideManual({ state: facts?.intake ?? null, assignedContractorId: facts?.contractor_id ?? null, requestedContractorId: o.contractorId });
  if (refused) return { ok: false, refusal: refused };

  const written = (await new sql.Request(tx)
    .input("standard", sql.UniqueIdentifier, o.standardId)
    .input("contractor", sql.UniqueIdentifier, facts!.contractor_id)
    .input("date", sql.Char(8), o.serviceDate)
    .input("quantity", sql.Int, o.quantity)
    .input("duration", sql.Int, o.durationDays)
    .input("qualifier", sql.NVarChar(50), o.qualifierCode)
    .input("description", sql.NVarChar(2000), o.description)
    .input("actor", sql.NVarChar(200), actor)
    .query<{ id: string; service_month: string }>(`
      INSERT ComplianceOccurrences(standard_id,contractor_id,service_date,quantity,duration_days,qualifier_code,description,source,review_status,attribution,created_by)
      OUTPUT inserted.id, inserted.service_month
      VALUES(@standard,@contractor,@date,@quantity,@duration,@qualifier,@description,'manual','confirmed','contractor_error',@actor)`)).recordset[0];
  await markInputChanged(tx, facts!.contractor_id!, written.service_month, actor);
  return { ok: true, occurrence: { id: written.id, contractorId: facts!.contractor_id!, serviceMonth: written.service_month } };
}

async function recordMissedTripReview(tx: sql.Transaction, o: Extract<RecordObservation, { kind: "missed_trip_review" }>, actor: string): Promise<IntakeOutcome> {
  const facts = (await new sql.Request(tx)
    .input("trip_id", sql.NVarChar(200), o.tripId)
    .input("date", sql.Char(8), o.serviceDate)
    .query<{
      source_ref: string; description: string; service_date: string; standard_id: string;
      intake: IntakeState; contractor_id: string | null;
      existing_id: string | null; existing_contractor_id: string | null; existing_month: string | null; existing_period_status: string | null;
    }>(`
      SELECT src.source_ref, src.description, src.service_date, s.id standard_id, x.intake, x.contractor_id,
        occ.id existing_id, occ.contractor_id existing_contractor_id, occ.service_month existing_month, ep.status existing_period_status
      FROM (
        SELECT ${occurrenceSourceRefSql("missed_trip", "m")} source_ref,
          CONCAT(N'Missed trip ',m.trip_id,N' on route ',m.route_id) description,
          CAST(LEFT(m.service_date,8) AS CHAR(8)) service_date
        FROM MonitoredMissedTrips m WHERE m.trip_id=@trip_id AND m.service_date=@date
      ) src
      CROSS JOIN ContractorPerformanceStandards s
      ${occurrenceAssignmentSql("src.service_date", "s.id", "x")}
      LEFT JOIN ComplianceOccurrences occ WITH (UPDLOCK, HOLDLOCK) ON occ.source_ref=src.source_ref
      LEFT JOIN AssessmentPeriods ep ON ep.contractor_id=occ.contractor_id AND ep.service_month=occ.service_month
      WHERE s.code='MISSED_TRIPS_FR'`)).recordset[0];
  if (!facts) return { ok: false, refusal: refusal("not_found", "The missed trip or the Missed Trips standard was not found.") };

  const dismissReason = o.reviewStatus === "dismissed" ? o.note : null;
  if (facts.existing_id) {
    // An earlier review or the poll raised it. It keeps its contractor; only
    // its own month's state can stop the restatement.
    const refused = decideChange({ periodStatus: facts.existing_period_status });
    if (refused) return { ok: false, refusal: refused };
    await new sql.Request(tx)
      .input("id", sql.UniqueIdentifier, facts.existing_id)
      .input("status", sql.NVarChar(20), o.reviewStatus)
      .input("attribution", sql.NVarChar(30), o.attribution)
      .input("reason", sql.NVarChar(1000), dismissReason)
      .input("actor", sql.NVarChar(200), actor)
      .query(`UPDATE ComplianceOccurrences SET review_status=@status,attribution=@attribution,dismiss_reason=@reason,reviewed_by=@actor,reviewed_at=SYSUTCDATETIME() WHERE id=@id`);
    await markInputChanged(tx, facts.existing_contractor_id!, facts.existing_month!, actor);
    return { ok: true, occurrence: { id: facts.existing_id, contractorId: facts.existing_contractor_id!, serviceMonth: facts.existing_month! } };
  }

  const refused = decideNew(facts.intake);
  if (refused) return { ok: false, refusal: refused };
  const written = (await new sql.Request(tx)
    .input("standard", sql.UniqueIdentifier, facts.standard_id)
    .input("contractor", sql.UniqueIdentifier, facts.contractor_id)
    .input("date", sql.Char(8), facts.service_date)
    .input("description", sql.NVarChar(2000), facts.description)
    .input("ref", sql.NVarChar(300), facts.source_ref)
    .input("status", sql.NVarChar(20), o.reviewStatus)
    .input("attribution", sql.NVarChar(30), o.attribution)
    .input("reason", sql.NVarChar(1000), dismissReason)
    .input("actor", sql.NVarChar(200), actor)
    .query<{ id: string; service_month: string }>(`
      INSERT ComplianceOccurrences(standard_id,contractor_id,service_date,quantity,description,source,source_ref,review_status,attribution,dismiss_reason,reviewed_by,reviewed_at,created_by)
      OUTPUT inserted.id, inserted.service_month
      VALUES(@standard,@contractor,@date,1,@description,'auto_candidate',@ref,@status,@attribution,@reason,@actor,SYSUTCDATETIME(),@actor)`)).recordset[0];
  await markInputChanged(tx, facts.contractor_id!, written.service_month, actor);
  return { ok: true, occurrence: { id: written.id, contractorId: facts.contractor_id!, serviceMonth: written.service_month } };
}

// ---------------------------------------------------------------------------
// resolveOccurrence / setAssessedAmount

interface Existing {
  id: string; contractor_id: string; service_month: string; period_status: string | null;
  min_amount: number | null; max_amount: number | null; relief_ok: number | null;
}

async function loadExisting(tx: sql.Transaction, id: string, reliefId: string | null): Promise<Existing | null> {
  return (await new sql.Request(tx)
    .input("id", sql.UniqueIdentifier, id)
    .input("relief", sql.UniqueIdentifier, reliefId)
    .query<Existing>(`
      SELECT o.id, o.contractor_id, o.service_month, p.status period_status,
        (SELECT TOP 1 t.penalty_amount_min FROM ContractorStandardTiers t
           WHERE t.standard_id=o.standard_id AND t.penalty_amount_min IS NOT NULL AND t.effective_end_date IS NULL ORDER BY t.tier_order) min_amount,
        (SELECT TOP 1 t.penalty_amount_max FROM ContractorStandardTiers t
           WHERE t.standard_id=o.standard_id AND t.penalty_amount_max IS NOT NULL AND t.effective_end_date IS NULL ORDER BY t.tier_order) max_amount,
        CASE WHEN @relief IS NULL THEN NULL WHEN EXISTS(SELECT 1 FROM ExcusableDelayClaims c
          WHERE c.id=@relief AND c.contractor_id=o.contractor_id AND c.service_month=o.service_month AND c.status<>'denied') THEN 1 ELSE 0 END relief_ok
      FROM ComplianceOccurrences o WITH (UPDLOCK, HOLDLOCK)
      LEFT JOIN AssessmentPeriods p ON p.contractor_id=o.contractor_id AND p.service_month=o.service_month
      WHERE o.id=@id`)).recordset[0] ?? null;
}

const writtenFrom = (row: Existing): Written => ({ id: row.id, contractorId: row.contractor_id, serviceMonth: row.service_month });

export async function resolveOccurrence(tx: sql.Transaction, id: string, resolution: Resolution, actor: string): Promise<IntakeOutcome> {
  if (!(await schemaReady(tx))) return { ok: false, refusal: refusal("schema_not_ready") };
  const existing = await loadExisting(tx, id, resolution.reliefId ?? null);
  const refused = decideChange(existing && { periodStatus: existing.period_status });
  if (refused) return { ok: false, refusal: refused };
  if (existing!.relief_ok === 0) return { ok: false, refusal: refusal("relief_mismatch") };

  await new sql.Request(tx)
    .input("id", sql.UniqueIdentifier, id)
    .input("status", sql.NVarChar(20), resolution.reviewStatus)
    .input("attribution", sql.NVarChar(30), resolution.attribution)
    .input("reason", sql.NVarChar(1000), resolution.dismissReason)
    .input("relief", sql.UniqueIdentifier, resolution.reliefId ?? null)
    .input("relief_given", sql.Bit, resolution.reliefId === undefined ? 0 : 1)
    .input("actor", sql.NVarChar(200), actor)
    .query(`
      UPDATE ComplianceOccurrences SET review_status=@status,attribution=@attribution,dismiss_reason=@reason,
        relief_id=CASE WHEN @relief_given=1 THEN @relief ELSE relief_id END,reviewed_by=@actor,reviewed_at=SYSUTCDATETIME()
      WHERE id=@id`);
  await markInputChanged(tx, existing!.contractor_id, existing!.service_month, actor);
  return { ok: true, occurrence: writtenFrom(existing!) };
}

export async function setAssessedAmount(tx: sql.Transaction, id: string, amount: AssessedAmount, actor: string): Promise<IntakeOutcome> {
  if (!(await schemaReady(tx))) return { ok: false, refusal: refusal("schema_not_ready") };
  const existing = await loadExisting(tx, id, null);
  const refused = decideAmount(existing && { periodStatus: existing.period_status, minAmount: existing.min_amount, maxAmount: existing.max_amount }, amount?.amount ?? null);
  if (refused) return { ok: false, refusal: refused };

  await new sql.Request(tx)
    .input("id", sql.UniqueIdentifier, id)
    .input("amount", sql.Decimal(12, 2), amount?.amount ?? null)
    .input("note", sql.NVarChar(1000), amount?.note ?? null)
    .input("actor", sql.NVarChar(200), actor)
    .query(`
      UPDATE ComplianceOccurrences
      SET assessed_amount=@amount, assessed_amount_note=@note,
          assessed_by=CASE WHEN @amount IS NULL THEN NULL ELSE @actor END,
          assessed_at=CASE WHEN @amount IS NULL THEN NULL ELSE SYSUTCDATETIME() END
      WHERE id=@id`);
  await markInputChanged(tx, existing!.contractor_id, existing!.service_month, actor);
  return { ok: true, occurrence: writtenFrom(existing!) };
}

// ---------------------------------------------------------------------------
// The Missed-trip case module's hand-off

// What the Compliance reviewer is told when a review did not reach the
// assessment. The review itself always commits: whether a trip was missed is
// a fact about service, not about how the assessment is set up.
export const REVIEW_HANDOFF_EXPLANATIONS: Record<string, string> = {
  unassigned: "The review was saved, but no single active Performance Agreement covers this service date, so it was not added to a performance assessment.",
  standard_not_scored: "The review was saved, but Missed Trips is not a scored standard on the Agreement for this date.",
  period_closed: "The review was saved. That month's assessment is already finalized or issued, so it was not changed - reopen the period to restate it.",
  not_found: "The review was saved, but the Missed Trips standard is not configured, so it was not added to a performance assessment.",
  schema_not_ready: "The review was saved, but the performance assessment tables are not available in this environment.",
};
