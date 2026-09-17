// Spare source adapter for the Missed-trip case module: evaluates the bounded,
// already-ingested Spare requests and slots for the missed-trip conditions,
// stores each evaluation in SpareMissedTripEvaluations (this source's own
// table), and reports what it found. It decides nothing about cases.
//
// Spare is retrospective: a request is evaluated once it has completed or been
// cancelled, so there is no second poll to wait for. An evaluation that cannot
// decide holds a case that already exists and opens none - most undecidable
// evaluations are requests nobody flagged.
import { sql } from "../../db";
import { agencyServiceDate } from "../../missedTripTime";
import {
  evaluateSpareMissedTrip,
  type SpareMissedTripEvaluation,
  type SpareMissedTripInput,
  type SparePickupSlot,
} from "../../spareMissedTripEvaluator";
import type { RunObservation, SpareDetectionType } from "../types";

const GRACE_MS = 30 * 60 * 1000;

interface SourceRow {
  request_id: string;
  duty_id: string | null;
  service_id: string | null;
  service_name: string | null;
  status: string;
  scheduled_pickup_at: Date | null;
  pickup_arrived_at: Date | null;
  pickup_lateness_seconds: number | null;
  dropoff_lateness_seconds: number | null;
  cancellation_fault: string | null;
  cancellation_reason: string | null;
  source_updated_at: Date | null;
}

interface SlotRow {
  slot_id: string;
  duty_id: string;
  request_id: string | null;
  slot_type: string;
  status: string | null;
  scheduled_at: Date | null;
}

export function spareMissedTripsEnabled(): boolean {
  return process.env.SPARE_MISSED_TRIPS_ENABLED?.trim().toLowerCase() === "true";
}

export function contractorFaultValues(): Set<string> {
  return new Set(
    (process.env.SPARE_CONTRACTOR_FAULT_VALUES ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean),
  );
}

export function spareDetectionType(evaluation: SpareMissedTripEvaluation): SpareDetectionType {
  const matched: SpareDetectionType[] = [];
  if (evaluation.conditionLateStart) matched.push("spare_late_start");
  if (evaluation.conditionSuperseded) matched.push("spare_superseded");
  if (evaluation.conditionLateArrival) matched.push("spare_late_arrival");
  return matched.length === 1 ? matched[0] : "spare_multiple";
}

// The observation for one evaluated request, or null when the request has no
// scheduled pickup to place it on a service date.
export function spareObservation(row: SourceRow, evaluation: SpareMissedTripEvaluation): RunObservation | null {
  if (!row.scheduled_pickup_at) return null;
  const run = {
    source: "spare" as const,
    runId: row.request_id,
    serviceDate: agencyServiceDate(row.scheduled_pickup_at).serviceDate,
    routeId: (row.service_name ?? row.service_id ?? "Spare").slice(0, 50),
    scheduledStartAt: row.scheduled_pickup_at,
    deadlineAt: new Date(row.scheduled_pickup_at.getTime() + GRACE_MS),
  };
  const detectorVersion = evaluation.calculationVersion;
  if (evaluation.decisionState === "candidate") {
    return {
      run,
      detectorVersion,
      fact: { kind: "service_failure", detectionType: spareDetectionType(evaluation), arrivedAt: row.pickup_arrived_at },
      evidence: {
        source: "spare", requestId: row.request_id, dutyId: row.duty_id, serviceId: row.service_id,
        serviceName: row.service_name, status: row.status, scheduledPickupAt: row.scheduled_pickup_at,
        pickupArrivedAt: row.pickup_arrived_at, pickupLatenessSeconds: row.pickup_lateness_seconds,
        dropoffLatenessSeconds: row.dropoff_lateness_seconds, cancellationFault: row.cancellation_fault,
        cancellationReason: row.cancellation_reason, sourceUpdatedAt: row.source_updated_at, evaluation,
      },
    };
  }
  if (evaluation.decisionState === "unknown_data_gap") {
    return { run, detectorVersion, fact: { kind: "evaluation_gap", reason: evaluation.unknownReason ?? "spare_data_gap" } };
  }
  return { run, detectorVersion, fact: { kind: "no_failure" } };
}

export interface SpareEvaluationTally {
  evaluated: number;
  candidates: number;
  unknown: number;
}

export async function spareObservations(pool: sql.ConnectionPool): Promise<{ observations: RunObservation[]; tally: SpareEvaluationTally }> {
  const sourceResult = await pool.request().query<SourceRow>(`
    SELECT request_id, duty_id, service_id, service_name, status, scheduled_pickup_at, pickup_arrived_at,
           pickup_lateness_seconds, dropoff_lateness_seconds,
           cancellation_fault, cancellation_reason, source_updated_at
    FROM SpareMissedTripSource
    WHERE (scheduled_pickup_at >= DATEADD(DAY, -7, SYSUTCDATETIME())
       OR ingested_at >= DATEADD(DAY, -7, SYSUTCDATETIME()))
      AND status IN ('completed', 'cancelled')
  `);
  const slotResult = await pool.request().query<SlotRow>(`
    SELECT slot_id, duty_id, request_id, slot_type, status, scheduled_at
    FROM SpareMissedTripSlots
    WHERE scheduled_at >= DATEADD(DAY, -8, SYSUTCDATETIME())
  `);
  const slotsByDuty = new Map<string, SparePickupSlot[]>();
  for (const row of slotResult.recordset) {
    const slots = slotsByDuty.get(row.duty_id) ?? [];
    slots.push({ slotId: row.slot_id, dutyId: row.duty_id, requestId: row.request_id, type: row.slot_type, status: row.status, scheduledAt: row.scheduled_at });
    slotsByDuty.set(row.duty_id, slots);
  }

  const faultValues = contractorFaultValues();
  const tally: SpareEvaluationTally = { evaluated: sourceResult.recordset.length, candidates: 0, unknown: 0 };
  const observations: RunObservation[] = [];
  for (const row of sourceResult.recordset) {
    const input: SpareMissedTripInput = {
      requestId: row.request_id, dutyId: row.duty_id, status: row.status,
      scheduledPickupAt: row.scheduled_pickup_at, pickupArrivedAt: row.pickup_arrived_at,
      pickupLatenessSeconds: row.pickup_lateness_seconds, dropoffLatenessSeconds: row.dropoff_lateness_seconds,
      cancellationFault: row.cancellation_fault, cancellationReason: row.cancellation_reason,
    };
    const evaluation = evaluateSpareMissedTrip(input, row.duty_id ? slotsByDuty.get(row.duty_id) ?? [] : [], { contractorFaultValues: faultValues });
    if (evaluation.decisionState === "candidate") tally.candidates++;
    if (evaluation.decisionState === "unknown_data_gap") tally.unknown++;

    await pool.request()
      .input("request_id", sql.NVarChar, row.request_id)
      .input("decision_state", sql.NVarChar, evaluation.decisionState)
      .input("condition_late_start", sql.Bit, evaluation.conditionLateStart)
      .input("condition_superseded", sql.Bit, evaluation.conditionSuperseded)
      .input("condition_late_arrival", sql.Bit, evaluation.conditionLateArrival)
      .input("start_delay_seconds", sql.Int, evaluation.startDelaySeconds)
      .input("arrival_delay_seconds", sql.Int, evaluation.arrivalDelaySeconds)
      .input("superseding_slot_at", sql.DateTime2, evaluation.supersedingSlotAt)
      .input("unknown_reason", sql.NVarChar, evaluation.unknownReason)
      .input("calculation_version", sql.NVarChar, evaluation.calculationVersion)
      .input("evidence_json", sql.NVarChar, JSON.stringify({ input, evaluation }))
      .query(`
        MERGE SpareMissedTripEvaluations WITH (HOLDLOCK) AS target
        USING (SELECT @request_id AS request_id) AS src
        ON target.request_id = src.request_id
        WHEN MATCHED THEN UPDATE SET
          decision_state = @decision_state, condition_late_start = @condition_late_start,
          condition_superseded = @condition_superseded, condition_late_arrival = @condition_late_arrival,
          start_delay_seconds = @start_delay_seconds, arrival_delay_seconds = @arrival_delay_seconds,
          superseding_slot_at = @superseding_slot_at, unknown_reason = @unknown_reason,
          calculation_version = @calculation_version, evaluated_at = SYSUTCDATETIME(), evidence_json = @evidence_json
        WHEN NOT MATCHED THEN INSERT (
          request_id, decision_state, condition_late_start, condition_superseded,
          condition_late_arrival, start_delay_seconds, arrival_delay_seconds,
          superseding_slot_at, unknown_reason, calculation_version, evidence_json
        ) VALUES (
          @request_id, @decision_state, @condition_late_start, @condition_superseded,
          @condition_late_arrival, @start_delay_seconds, @arrival_delay_seconds,
          @superseding_slot_at, @unknown_reason, @calculation_version, @evidence_json
        );
      `);
    const observation = spareObservation(row, evaluation);
    if (observation) observations.push(observation);
  }
  return { observations, tally };
}
