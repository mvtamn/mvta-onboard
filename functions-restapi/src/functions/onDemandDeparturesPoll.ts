// Timer-triggered ingestion of on-demand garage departures from Spare - the
// Spare half of the concept ADR 0028 splits by service type
// (FixedRouteDepartures is the Avail half). A GROWING HISTORICAL LOG keyed by
// duty id, MERGEd as each duty's day progresses and never deleted.
//
// Which duties to measure is learned from the requests the missed-trips
// ingest already stores (SpareMissedTripSource), not from a duties listing:
// that ingest is scoped to the on-demand Spare services, so the duties it
// names are on-demand by construction and fixed-route duties, should Spare
// ever carry them, never enter this path. Open item 12 of the Spare spec,
// reframed by ADR 0028 as a guard, is satisfied by inheritance.
//
// Per duty this makes two bounded Spare calls: the duty by id, and its
// startLocation slots. Rider fields are never requested; driver and vehicle
// are stored as ids.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { feedHealthOutcome, recordFeedFailure, recordFeedHealth } from "../lib/kpiFeedHealth";
import { agencyServiceDate, serviceDateAndGtfsSecondsToUtc } from "../lib/missedTripTime";
import { onDemandDeparturesEnabled, resolveOnDemandDeparture, type ResolvedOnDemandDeparture } from "../lib/onDemandDepartures";
import { fetchSpareDuty, fetchSparePage, type SpareDutyRecord, type SpareSlotRecord } from "../lib/spareApi";

const DUTY_CONCURRENCY = 8;
// A duty has one start-location slot; a handful allows for re-planning.
const START_SLOT_LIMIT = 20;
// Today's and yesterday's duties, plus any older row still awaiting an
// actual. Well above a day of MVTA Connect duties; the cap is a safety stop
// against a runaway working set, not a sizing.
const MAX_DUTIES_PER_RUN = 400;

async function fetchStartLocationSlots(dutyId: string): Promise<SpareSlotRecord[]> {
  const page = await fetchSparePage<SpareSlotRecord>("/v1/slots", new URLSearchParams({
    dutyId,
    type: "startLocation",
    // updatedAt is the one sort key this repo has seen Spare honour; the
    // resolver orders by scheduled time itself.
    orderBy: "updatedAt",
    orderDirection: "ASC",
    limit: String(START_SLOT_LIMIT),
    skip: "0",
  }));
  return page.data;
}

export async function fetchDutyDeparture(
  dutyId: string,
  fetchDuty: (dutyId: string) => Promise<SpareDutyRecord> = fetchSpareDuty,
  fetchSlots: (dutyId: string) => Promise<SpareSlotRecord[]> = fetchStartLocationSlots,
): Promise<ResolvedOnDemandDeparture | null> {
  const [duty, slots] = await Promise.all([fetchDuty(dutyId), fetchSlots(dutyId)]);
  // Spare's duty id is authoritative; the record's own id should agree, but a
  // record that omits it must still be keyed by the id we asked for.
  return resolveOnDemandDeparture({ ...duty, id: duty.id ?? dutyId }, slots);
}

// The agency-local day a departure belongs to: the scheduled one, else the
// actual. A duty with neither cannot be placed on a day and is not stored.
export function departureServiceDate(departure: ResolvedOnDemandDeparture): string | null {
  const instant = departure.departureScheduled ?? departure.departureActual;
  return instant ? agencyServiceDate(instant).serviceDate : null;
}

async function workingSet(pool: sql.ConnectionPool): Promise<string[]> {
  const yesterday = agencyServiceDate(new Date(), -1).serviceDate;
  const request = pool.request();
  request.input("since", sql.DateTime2, serviceDateAndGtfsSecondsToUtc(yesterday, 0) ?? new Date(Date.now() - 36 * 3_600_000));
  request.input("since_service_date", sql.Char(8), yesterday);
  request.input("cap", sql.Int, MAX_DUTIES_PER_RUN);
  const result = await request.query<{ duty_id: string }>(`
    SELECT TOP (@cap) duty_id FROM (
      SELECT duty_id FROM SpareMissedTripSource
        WHERE duty_id IS NOT NULL AND scheduled_pickup_at >= @since
      UNION
      SELECT duty_id FROM OnDemandDepartures
        WHERE departure_actual IS NULL AND service_date >= @since_service_date
    ) duties
    ORDER BY duty_id
  `);
  return result.recordset.map((row) => row.duty_id);
}

async function upsert(pool: sql.ConnectionPool, departure: ResolvedOnDemandDeparture, serviceDate: string): Promise<void> {
  const request = pool.request();
  request.input("duty_id", sql.NVarChar(64), departure.dutyId);
  request.input("service_date", sql.Char(8), serviceDate);
  request.input("duty_identifier", sql.NVarChar(64), departure.dutyIdentifier);
  request.input("driver_id", sql.NVarChar(64), departure.driverId);
  request.input("vehicle_id", sql.NVarChar(64), departure.vehicleId);
  request.input("duty_status", sql.NVarChar(32), departure.dutyStatus);
  request.input("departure_scheduled", sql.DateTime2, departure.departureScheduled);
  request.input("scheduled_source", sql.NVarChar(32), departure.scheduledSource);
  request.input("departure_actual", sql.DateTime2, departure.departureActual);
  request.input("departure_source", sql.NVarChar(32), departure.departureSource);
  request.input("slot_id", sql.NVarChar(64), departure.slotId);
  request.input("source_updated_at", sql.DateTime2, departure.sourceUpdatedAt);
  await request.query(`
    MERGE OnDemandDepartures WITH (HOLDLOCK) AS target
    USING (SELECT @duty_id AS duty_id) AS src ON target.duty_id = src.duty_id
    WHEN MATCHED AND (target.source_updated_at IS NULL OR @source_updated_at IS NULL OR @source_updated_at >= target.source_updated_at)
      THEN UPDATE SET
        service_date = @service_date, duty_identifier = @duty_identifier,
        driver_id = @driver_id, vehicle_id = @vehicle_id, duty_status = @duty_status,
        departure_scheduled = @departure_scheduled, scheduled_source = @scheduled_source,
        departure_actual = @departure_actual, departure_source = @departure_source,
        slot_id = @slot_id, source_updated_at = @source_updated_at, updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (
      duty_id, service_date, duty_identifier, driver_id, vehicle_id, duty_status,
      departure_scheduled, scheduled_source, departure_actual, departure_source, slot_id, source_updated_at
    ) VALUES (
      @duty_id, @service_date, @duty_identifier, @driver_id, @vehicle_id, @duty_status,
      @departure_scheduled, @scheduled_source, @departure_actual, @departure_source, @slot_id, @source_updated_at
    );
  `);
}

app.timer("onDemandDeparturesPoll", {
  // Offset from the missed-trips ingest (2/15) so a run sees the requests
  // that ingest just stored.
  schedule: "0 7/15 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    if (!onDemandDeparturesEnabled()) {
      context.log("On-demand departures ingestion is disabled (ON_DEMAND_DEPARTURES_ENABLED is not true).");
      return;
    }
    const pool = await getPool();
    const ready = await pool.request().query<{ ready: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.OnDemandDepartures','U') IS NOT NULL
        AND OBJECT_ID('dbo.SpareMissedTripSource','U') IS NOT NULL THEN 1 ELSE 0 END ready
    `);
    if (!ready.recordset[0]?.ready) {
      context.warn("On-demand departures tables are not ready; migration 096 (and 028) may be pending.");
      return;
    }

    // Guarded as a whole, like the missed-trips ingest: a throw must land in
    // the health ledger as a failure, never leave it frozen on a stale success.
    try {
      const dutyIds = await workingSet(pool);
      let stored = 0;
      let undated = 0;
      let maxSourceUpdatedAt = 0;
      const failures: string[] = [];
      for (let index = 0; index < dutyIds.length; index += DUTY_CONCURRENCY) {
        const batch = dutyIds.slice(index, index + DUTY_CONCURRENCY);
        const departures = await Promise.all(batch.map(async (dutyId) => {
          try {
            return await fetchDutyDeparture(dutyId);
          } catch (err) {
            failures.push(`${dutyId}: ${err instanceof Error ? err.message : String(err)}`);
            return null;
          }
        }));
        for (const departure of departures) {
          if (!departure) continue;
          const serviceDate = departureServiceDate(departure);
          if (!serviceDate) { undated++; continue; }
          await upsert(pool, departure, serviceDate);
          stored++;
          const updatedAt = departure.sourceUpdatedAt ? Math.floor(departure.sourceUpdatedAt.getTime() / 1000) : 0;
          maxSourceUpdatedAt = Math.max(maxSourceUpdatedAt, updatedAt);
        }
      }

      if (failures.length > 0) {
        context.warn(`On-demand departures poll: ${failures.length} of ${dutyIds.length} duties could not be read. ` +
          failures.slice(0, 5).join("; "));
      }
      if (undated > 0) {
        context.warn(`On-demand departures poll: ${undated} duties carried no scheduled or actual departure and were not stored.`);
      }
      if (dutyIds.length >= MAX_DUTIES_PER_RUN) {
        context.warn(`On-demand departures poll: working set hit the ${MAX_DUTIES_PER_RUN}-duty cap; some duties wait for the next run.`);
      }

      // Undated duties were skipped deliberately, so they are not loss.
      const outcome = feedHealthOutcome(dutyIds.length - undated, stored, "duties");
      if (outcome.kind === "failure") {
        context.error(`On-demand departures poll: ${outcome.reason}`);
        await recordFeedFailure(pool, "spare_duties", new Error(outcome.reason));
        return;
      }
      await recordFeedHealth(pool, "spare_duties", outcome.entityCount, maxSourceUpdatedAt || null, {
        startAt: serviceDateAndGtfsSecondsToUtc(agencyServiceDate(new Date(), -1).serviceDate, 0),
        endAt: new Date(),
      });
      context.log(`On-demand departures poll: ${dutyIds.length} duties in the working set, ${stored} rows upserted.`);
    } catch (err) {
      context.error("On-demand departures poll failed:", err);
      try {
        await recordFeedFailure(pool, "spare_duties", err);
      } catch (healthError) {
        context.error("Failed to record on-demand departures feed failure:", healthError);
      }
      throw err;
    }
  },
});
