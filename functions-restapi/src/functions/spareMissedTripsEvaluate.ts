// Evaluates already-ingested Spare Ridership Export + Slots records for the
// three Missed Trips conditions. Ingestion is deliberately separate: the
// live export's pagination/auth query contract still needs confirmation.
// This evaluator is disabled by default and does no ridership, wait-time, or
// garage-departure work.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import {
  evaluateSpareMissedTrip,
  type SpareMissedTripInput,
  type SparePickupSlot,
} from "../lib/spareMissedTripEvaluator";

interface SourceRow {
  request_id: string;
  duty_id: string | null;
  status: string;
  scheduled_pickup_at: Date | null;
  pickup_arrived_at: Date | null;
  pickup_lateness_seconds: number | null;
  dropoff_lateness_seconds: number | null;
  cancellation_fault: string | null;
  cancellation_reason: string | null;
}

interface SlotRow {
  slot_id: string;
  duty_id: string;
  request_id: string | null;
  slot_type: string;
  scheduled_at: Date | null;
}

function enabled(): boolean {
  return process.env.SPARE_MISSED_TRIPS_ENABLED?.trim().toLowerCase() === "true";
}

function contractorFaultValues(): Set<string> {
  return new Set(
    (process.env.SPARE_CONTRACTOR_FAULT_VALUES ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

app.timer("spareMissedTripsEvaluate", {
  schedule: "0 */15 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    if (!enabled()) {
      context.log("Spare missed-trip evaluation is disabled (SPARE_MISSED_TRIPS_ENABLED is not true).");
      return;
    }

    const pool = await getPool();
    const tableCheck = await pool.request().query<{ ready: number }>(`
      SELECT CASE
        WHEN OBJECT_ID('dbo.SpareMissedTripSource', 'U') IS NOT NULL
         AND OBJECT_ID('dbo.SpareMissedTripSlots', 'U') IS NOT NULL
         AND OBJECT_ID('dbo.SpareMissedTripEvaluations', 'U') IS NOT NULL
        THEN 1 ELSE 0 END AS ready
    `);
    if (tableCheck.recordset[0]?.ready !== 1) {
      context.warn("Spare Missed Trips tables are not ready; apply migration 028.");
      return;
    }

    const sourceResult = await pool.request().query<SourceRow>(`
      SELECT request_id, duty_id, status, scheduled_pickup_at, pickup_arrived_at,
             pickup_lateness_seconds, dropoff_lateness_seconds,
             cancellation_fault, cancellation_reason
      FROM SpareMissedTripSource
      WHERE scheduled_pickup_at >= DATEADD(DAY, -7, SYSUTCDATETIME())
         OR ingested_at >= DATEADD(DAY, -7, SYSUTCDATETIME())
    `);
    const slotResult = await pool.request().query<SlotRow>(`
      SELECT slot_id, duty_id, request_id, slot_type, scheduled_at
      FROM SpareMissedTripSlots
      WHERE scheduled_at >= DATEADD(DAY, -8, SYSUTCDATETIME())
    `);
    const slotsByDuty = new Map<string, SparePickupSlot[]>();
    for (const row of slotResult.recordset) {
      const slots = slotsByDuty.get(row.duty_id) ?? [];
      slots.push({
        slotId: row.slot_id,
        dutyId: row.duty_id,
        requestId: row.request_id,
        type: row.slot_type,
        scheduledAt: row.scheduled_at,
      });
      slotsByDuty.set(row.duty_id, slots);
    }

    const faultValues = contractorFaultValues();
    let candidates = 0;
    let unknown = 0;
    for (const row of sourceResult.recordset) {
      const input: SpareMissedTripInput = {
        requestId: row.request_id,
        dutyId: row.duty_id,
        status: row.status,
        scheduledPickupAt: row.scheduled_pickup_at,
        pickupArrivedAt: row.pickup_arrived_at,
        pickupLatenessSeconds: row.pickup_lateness_seconds,
        dropoffLatenessSeconds: row.dropoff_lateness_seconds,
        cancellationFault: row.cancellation_fault,
        cancellationReason: row.cancellation_reason,
      };
      const evaluation = evaluateSpareMissedTrip(
        input,
        row.duty_id ? slotsByDuty.get(row.duty_id) ?? [] : [],
        { contractorFaultValues: faultValues },
      );
      if (evaluation.decisionState === "candidate") candidates++;
      if (evaluation.decisionState === "unknown_data_gap") unknown++;

      const req = pool.request();
      req.input("request_id", sql.NVarChar, row.request_id);
      req.input("decision_state", sql.NVarChar, evaluation.decisionState);
      req.input("condition_late_start", sql.Bit, evaluation.conditionLateStart);
      req.input("condition_superseded", sql.Bit, evaluation.conditionSuperseded);
      req.input("condition_late_arrival", sql.Bit, evaluation.conditionLateArrival);
      req.input("start_delay_seconds", sql.Int, evaluation.startDelaySeconds);
      req.input("arrival_delay_seconds", sql.Int, evaluation.arrivalDelaySeconds);
      req.input("superseding_slot_at", sql.DateTime2, evaluation.supersedingSlotAt);
      req.input("unknown_reason", sql.NVarChar, evaluation.unknownReason);
      req.input("calculation_version", sql.NVarChar, evaluation.calculationVersion);
      req.input("evidence_json", sql.NVarChar, JSON.stringify({ input, evaluation }));
      await req.query(`
        MERGE SpareMissedTripEvaluations WITH (HOLDLOCK) AS target
        USING (SELECT @request_id AS request_id) AS src
        ON target.request_id = src.request_id
        WHEN MATCHED THEN UPDATE SET
          decision_state = @decision_state,
          condition_late_start = @condition_late_start,
          condition_superseded = @condition_superseded,
          condition_late_arrival = @condition_late_arrival,
          start_delay_seconds = @start_delay_seconds,
          arrival_delay_seconds = @arrival_delay_seconds,
          superseding_slot_at = @superseding_slot_at,
          unknown_reason = @unknown_reason,
          calculation_version = @calculation_version,
          evaluated_at = SYSUTCDATETIME(),
          evidence_json = @evidence_json
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
    }

    context.log(
      `Spare missed-trip evaluation: ${sourceResult.recordset.length} requests evaluated, ` +
        `${candidates} candidates, ${unknown} unknown-data outcomes.`,
    );
    if (faultValues.size === 0) {
      context.warn(
        "SPARE_CONTRACTOR_FAULT_VALUES is empty; cancellations remain unknown instead of being auto-flagged.",
      );
    }
  },
});
