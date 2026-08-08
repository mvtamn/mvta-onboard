// Evaluates bounded, already-ingested Spare Requests + Slots records for the
// three Missed Trips conditions and projects candidates into the shared
// review queue. It does no ridership, wait-time, or garage-departure work.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { agencyServiceDate } from "../lib/missedTripTime";
import {
  evaluateSpareMissedTrip,
  type SpareMissedTripInput,
  type SparePickupSlot,
} from "../lib/spareMissedTripEvaluator";

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

function detectionType(evaluation: ReturnType<typeof evaluateSpareMissedTrip>): string {
  const matched = [
    evaluation.conditionLateStart ? "spare_late_start" : null,
    evaluation.conditionSuperseded ? "spare_superseded" : null,
    evaluation.conditionLateArrival ? "spare_late_arrival" : null,
  ].filter(Boolean);
  return matched.length === 1 ? matched[0]! : "spare_multiple";
}

async function projectEvaluation(
  pool: sql.ConnectionPool,
  row: SourceRow,
  evaluation: ReturnType<typeof evaluateSpareMissedTrip>,
): Promise<void> {
  const tripId = `spare:${row.request_id}`;
  if (evaluation.decisionState !== "candidate") {
    const resolve = pool.request();
    resolve.input("trip_id", sql.NVarChar(100), tripId);
    await resolve.query(`
      UPDATE MonitoredMissedTrips
      SET status = 'resolved', last_checked_at = SYSUTCDATETIME()
      WHERE trip_id = @trip_id AND source_system = 'spare'
        AND validation_status = 'unreviewed' AND status <> 'resolved'
    `);
    return;
  }
  if (!row.scheduled_pickup_at) return;
  const serviceDate = agencyServiceDate(row.scheduled_pickup_at).serviceDate;
  const routeId = (row.service_name ?? row.service_id ?? "Spare").slice(0, 50);
  const graceDeadline = new Date(row.scheduled_pickup_at.getTime() + 30 * 60 * 1000);
  const type = detectionType(evaluation);
  const evidence = JSON.stringify({
    source: "spare",
    requestId: row.request_id,
    dutyId: row.duty_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    status: row.status,
    scheduledPickupAt: row.scheduled_pickup_at,
    pickupArrivedAt: row.pickup_arrived_at,
    pickupLatenessSeconds: row.pickup_lateness_seconds,
    dropoffLatenessSeconds: row.dropoff_lateness_seconds,
    cancellationFault: row.cancellation_fault,
    cancellationReason: row.cancellation_reason,
    sourceUpdatedAt: row.source_updated_at,
    evaluation,
  });
  const req = pool.request();
  req.input("trip_id", sql.NVarChar(100), tripId);
  req.input("service_date", sql.NVarChar(20), serviceDate);
  req.input("route_id", sql.NVarChar(50), routeId);
  req.input("scheduled_departure_at", sql.DateTime2, row.scheduled_pickup_at);
  req.input("grace_deadline_at", sql.DateTime2, graceDeadline);
  req.input("detection_type", sql.NVarChar(30), type);
  req.input("detected_late_arrival_at", sql.DateTime2, row.pickup_arrived_at);
  req.input("source_record_id", sql.NVarChar(100), row.request_id);
  req.input("detector_version", sql.NVarChar(30), evaluation.calculationVersion);
  req.input("evidence_json", sql.NVarChar(sql.MAX), evidence);
  await req.query(`
    MERGE MonitoredMissedTrips WITH (HOLDLOCK) AS target
    USING (SELECT @trip_id AS trip_id, @service_date AS service_date) AS src
    ON target.trip_id = src.trip_id AND target.service_date = src.service_date
    WHEN MATCHED THEN UPDATE SET
      route_id = @route_id,
      scheduled_departure_at = @scheduled_departure_at,
      grace_deadline_at = @grace_deadline_at,
      status = CASE WHEN target.validation_status = 'unreviewed' THEN 'escalated' ELSE target.status END,
      detection_type = @detection_type,
      detected_late_arrival_at = @detected_late_arrival_at,
      last_checked_at = SYSUTCDATETIME(),
      detector_version = @detector_version,
      source_system = 'spare',
      source_record_id = @source_record_id,
      evidence_json = @evidence_json
    WHEN NOT MATCHED THEN INSERT (
      trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at,
      status, detection_type, detected_late_arrival_at, detector_version,
      data_quality_status, source_system, source_record_id, evidence_json
    ) VALUES (
      @trip_id, @service_date, @route_id, @scheduled_departure_at, @grace_deadline_at,
      'escalated', @detection_type, @detected_late_arrival_at, @detector_version,
      'source_verified', 'spare', @source_record_id, @evidence_json
    );
  `);
}

app.timer("spareMissedTripsEvaluate", {
  schedule: "0 5/15 * * * *",
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
      slots.push({
        slotId: row.slot_id,
        dutyId: row.duty_id,
        requestId: row.request_id,
        type: row.slot_type,
        status: row.status,
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
      await projectEvaluation(pool, row, evaluation);
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
