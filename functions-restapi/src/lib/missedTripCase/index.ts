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
  linkMissedTripOccurrence,
  OCCURRENCE_LINK_EXPLANATIONS,
  type OccurrenceLinkOutcome,
} from "../assessment/occurrenceIntake";
import { classifyMissedTripCase, promotedDetectors } from "./classify";
import { caseTripId, decideRun, type CaseState } from "./decide";
import { caseKey, loadCase, loadCases, writeDecision } from "./store";
import type { Actor, CaseAct, CaseKey, MissedTripClassification, ObserveReport, RunObservation } from "./types";

export * from "./types";
export { classifyMissedTripCase, missedTripCaseSql, missedTripSourceRefSql, promotedDetectors } from "./classify";

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

export type ReviewHandOff = OccurrenceLinkOutcome | { linked: false; reason: "shadow_detection" };

export const SHADOW_DETECTION_EXPLANATION =
  "The review was saved. This case comes from a detector still in Shadow detection, so it is not added to a performance assessment.";

export function handOffExplanation(outcome: ReviewHandOff): string | null {
  if (outcome.linked) return null;
  return outcome.reason === "shadow_detection" ? SHADOW_DETECTION_EXPLANATION : OCCURRENCE_LINK_EXPLANATIONS[outcome.reason];
}

export type ActOutcome =
  | { ok: true; classification: MissedTripClassification; handOff: ReviewHandOff | null }
  | { ok: false; refusal: { code: "not_found"; sentence: string } };

const NOT_FOUND = { ok: false as const, refusal: { code: "not_found" as const, sentence: "This missed trip was not found." } };

function classificationOf(state: CaseState): MissedTripClassification {
  return classifyMissedTripCase(state);
}

export async function actOnMissedTripCase(pool: sql.ConnectionPool, key: CaseKey, act: CaseAct, actor: Actor): Promise<ActOutcome> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const current = await loadCase(tx, key.tripId, key.serviceDate, true);
    if (!current) {
      await tx.rollback();
      return NOT_FOUND;
    }

    await new sql.Request(tx)
      .input("trip_id", sql.NVarChar(100), key.tripId)
      .input("service_date", sql.NVarChar(20), key.serviceDate)
      .input("validation_status", sql.NVarChar(20), act.outcome)
      .input("validated_by", sql.NVarChar(200), actor.name)
      .input("notes", sql.NVarChar(1000), act.notes)
      .input("reason_code", sql.NVarChar(30), act.reasonCode)
      .input("previous_validation_status", sql.NVarChar(20), current.validation_status)
      .query(`
        UPDATE MonitoredMissedTrips
        SET validation_status = @validation_status,
            validated_by = @validated_by,
            validated_at = SYSUTCDATETIME(),
            notes = @notes,
            reason_code = @reason_code,
            data_quality_status = CASE WHEN @validation_status = 'confirmed' THEN 'source_verified' ELSE data_quality_status END
        WHERE trip_id = @trip_id AND service_date = @service_date;

        INSERT INTO MissedTripReviewHistory (
          trip_id, service_date, previous_validation_status, validation_status, reason_code, notes, reviewed_by
        )
        VALUES (@trip_id, @service_date, @previous_validation_status, @validation_status, @reason_code, @notes, @validated_by);
      `);
    const reviewed = await loadCase(tx, key.tripId, key.serviceDate, false);
    const classification = classificationOf(reviewed ?? current);

    // Assessment promotion: a confirmation from a detector in Shadow detection
    // stays out of the assessment. A Timely-service review still reaches
    // intake, so an occurrence raised before the gate existed is dismissed.
    const promoted = promotedDetectors();
    let handOff: ReviewHandOff;
    if (act.outcome === "confirmed" && !promoted.has(classification.detector)) {
      handOff = { linked: false, reason: "shadow_detection" };
    } else {
      handOff = await linkMissedTripOccurrence(tx, {
        tripId: key.tripId,
        serviceDate: key.serviceDate,
        validationStatus: act.outcome,
        attribution: act.attribution,
        actor: actor.name,
        note: act.outcome === "false_positive"
          ? `Missed trip review recorded a false positive (${act.reasonCode}).`
          : act.notes ?? `Attribution recorded at review as ${act.attribution}.`,
      });
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
