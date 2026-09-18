// The Missed-trip case module. It is the only writer of MonitoredMissedTrips
// and MissedTripReviewHistory, and the one place that says what a case is:
//
//   observeMissedTrips   - sources report what they observed; the module
//                          decides every create, hold, confirmation and closure.
//   actOnMissedTripCase  - what a person does to a case.
//   classifyMissedTripCase / missedTripCaseSql
//                        - lifecycle, finding, outcome and the counting flags,
//                          in TypeScript and as SQL, for every reader.
//
// Source adapters (adapters/gtfs.ts, adapters/spare.ts) turn stored source
// rows into observations; the module never reads a source's tables.
import { sql } from "../db";
import {
  occurrenceStateFor,
  recordOccurrence,
  REVIEW_HANDOFF_EXPLANATIONS,
  type IntakeRefusalCode,
  type OccurrenceReviewStatus,
} from "../occurrenceIntake";
import { classifyMissedTripCase } from "./classify";
import { detectorPromotionWindows } from "./promotion";
import { caseTripId, decideReview, decideRun } from "./decide";
import { caseKey, loadCase, loadCases, writeDecision } from "./store";
import type { Actor, CaseAct, CaseKey, CaseRefusal, MissedTripClassification, ObserveReport, RunObservation, StoredReviewOutcome } from "./types";

export * from "./types";
export { classifyMissedTripCase, missedTripCaseSql, missedTripSourceRefSql } from "./classify";
export * from "./promotion";
export { missedTripDetectionSettings, type MissedTripDetectionSettings } from "./settings";
export {
  caseQuery,
  caseTablesReady,
  readMissedTripCases,
  readMissedTripMonthlySummary,
  viewCount,
  DEFAULT_CASE_LIMIT,
  MAX_CASE_LIMIT,
  type CaseListRow,
  type CaseQuery,
  type CaseReadResult,
  type CaseTablesReady,
  type CaseTotals,
  type CaseView,
  type MissedTripsSummaryRow,
  type MonthlySummaryResult,
} from "./reads";

export async function observeMissedTrips(pool: sql.ConnectionPool, observations: RunObservation[], now = new Date()): Promise<ObserveReport> {
  const report: ObserveReport = { created: 0, held: 0, confirmed: 0, closedByEvidence: 0, evidenceRecorded: 0, skippedChanged: 0, failed: [] };
  const byRun = new Map<string, RunObservation[]>();
  for (const observation of observations) {
    const key = caseKey(caseTripId(observation.run.source, observation.run.runId), observation.run.serviceDate);
    const list = byRun.get(key) ?? [];
    list.push(observation);
    byRun.set(key, list);
  }
  const stored = await loadCases(pool, [...byRun.values()].map((list) => ({
    tripId: caseTripId(list[0].run.source, list[0].run.runId),
    serviceDate: list[0].run.serviceDate,
  })));

  for (const [key, list] of byRun) {
    const decision = decideRun(stored.get(key) ?? null, list, now);
    if (!decision) continue;
    try {
      if (!(await writeDecision(pool, decision))) {
        report.skippedChanged++;
        continue;
      }
      const outcome = decision.outcome;
      if (outcome === "created") report.created++;
      else if (outcome === "held") report.held++;
      else if (outcome === "confirmed") report.confirmed++;
      else if (outcome === "closed_by_evidence") report.closedByEvidence++;
      else report.evidenceRecorded++;
    } catch (error) {
      report.failed.push({ runId: list[0].run.runId, serviceDate: list[0].run.serviceDate, error });
    }
  }
  return report;
}

export type ReviewHandOff =
  | { linked: true; occurrence_id: string; service_month: string; review_status: OccurrenceReviewStatus; standard_code: "MISSED_TRIPS_FR" }
  | { linked: false; reason: IntakeRefusalCode | "shadow_detection" };

export const SHADOW_DETECTION_EXPLANATION =
  "The review was saved. This case comes from a detector still in Shadow detection, so it is not added to a performance assessment.";

export function handOffExplanation(outcome: ReviewHandOff): string | null {
  if (outcome.linked) return null;
  return outcome.reason === "shadow_detection" ? SHADOW_DETECTION_EXPLANATION : REVIEW_HANDOFF_EXPLANATIONS[outcome.reason] ?? REVIEW_HANDOFF_EXPLANATIONS.schema_not_ready;
}

export type ActOutcome =
  | { ok: true; classification: MissedTripClassification; handOff: ReviewHandOff }
  | { ok: false; refusal: CaseRefusal };

const NOT_FOUND: ActOutcome = { ok: false, refusal: { code: "not_found", sentence: "This missed trip was not found." } };

const OUTCOME_NOTES: Record<StoredReviewOutcome, string> = {
  confirmed: "",
  timely_service: "Missed trip review found Timely service",
  partial_service_failure: "Missed trip review found a Partial-service failure, not a missed trip",
  indeterminate: "Missed trip review could not determine the outcome",
};

export async function actOnMissedTripCase(pool: sql.ConnectionPool, key: CaseKey, act: CaseAct, actor: Actor, now = new Date()): Promise<ActOutcome> {
  // Read before the transaction opens: promotion is the same for every case.
  const promoted = await detectorPromotionWindows(pool);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const current = await loadCase(tx, key.tripId, key.serviceDate, true);
    if (!current) {
      await tx.rollback();
      return NOT_FOUND;
    }
    const decision = decideReview(current, act, now);
    if ("refusal" in decision) {
      await tx.rollback();
      return { ok: false, refusal: decision.refusal };
    }
    const review = decision.review;

    await new sql.Request(tx)
      .input("trip_id", sql.NVarChar(100), key.tripId)
      .input("service_date", sql.NVarChar(20), key.serviceDate)
      .input("validation_status", sql.NVarChar(30), review.validation_status)
      .input("data_quality_status", sql.NVarChar(30), review.data_quality_status)
      .input("validated_by", sql.NVarChar(200), actor.name)
      .input("notes", sql.NVarChar(1000), act.notes)
      .input("reason_code", sql.NVarChar(30), act.reasonCode)
      .input("previous_validation_status", sql.NVarChar(30), current.validation_status)
      .input("review_kind", sql.NVarChar(20), review.review_kind)
      .input("review_reason", sql.NVarChar(1000), review.review_reason)
      .query(`
        UPDATE MonitoredMissedTrips
        SET validation_status = @validation_status,
            data_quality_status = @data_quality_status,
            validated_by = @validated_by,
            validated_at = SYSUTCDATETIME(),
            notes = @notes,
            reason_code = @reason_code
        WHERE trip_id = @trip_id AND service_date = @service_date;

        INSERT INTO MissedTripReviewHistory (
          trip_id, service_date, previous_validation_status, validation_status, reason_code, notes, reviewed_by,
          review_kind, review_reason
        )
        VALUES (@trip_id, @service_date, @previous_validation_status, @validation_status, @reason_code, @notes, @validated_by,
          @review_kind, @review_reason);
      `);
    const reviewed = await loadCase(tx, key.tripId, key.serviceDate, false);
    const classification = classifyMissedTripCase(reviewed ?? current, promoted, now);

    // Assessment promotion: a confirmation from a detector in Shadow detection
    // stays out of the assessment. Every other outcome still reaches intake, so
    // an occurrence raised by an earlier confirmation is dismissed.
    let handOff: ReviewHandOff;
    if (act.outcome === "confirmed" && !classification.counts_toward_assessment) {
      handOff = { linked: false, reason: "shadow_detection" };
    } else {
      const state = occurrenceStateFor(act.outcome === "confirmed" ? "confirmed" : "false_positive", act.attribution);
      const recorded = await recordOccurrence(tx, {
        kind: "missed_trip_review",
        tripId: key.tripId,
        serviceDate: key.serviceDate,
        reviewStatus: state.review_status,
        attribution: state.attribution,
        note: act.outcome === "confirmed"
          ? act.notes ?? `Attribution recorded at review as ${act.attribution}.`
          : `${OUTCOME_NOTES[act.outcome]} (${act.reasonCode}).`,
      }, actor.name);
      handOff = recorded.ok
        ? { linked: true, occurrence_id: recorded.occurrence.id, service_month: recorded.occurrence.serviceMonth, review_status: state.review_status, standard_code: "MISSED_TRIPS_FR" }
        : { linked: false, reason: recorded.refusal.code };
    }
    await tx.commit();
    return { ok: true, classification, handOff };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // The transaction may already have ended.
    }
    throw err;
  }
}

// Records the rider alert prepared from a case, inside the alert's own
// transaction. A missing service date links every date of the trip, as the
// prepare flow always has.
export async function linkMissedTripRiderAlert(tx: sql.Transaction, tripId: string, serviceDate: string | null, suggestedAlertId: string): Promise<void> {
  await new sql.Request(tx)
    .input("trip_id", sql.NVarChar(100), tripId)
    .input("service_date", sql.NVarChar(20), serviceDate)
    .input("alert_id", sql.UniqueIdentifier, suggestedAlertId)
    .query(`
      UPDATE MonitoredMissedTrips SET suggested_alert_id = @alert_id
      WHERE trip_id = @trip_id AND (@service_date IS NULL OR service_date = @service_date)`);
}
