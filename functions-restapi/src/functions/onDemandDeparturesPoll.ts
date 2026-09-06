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
import { driverLabelFrom, DriverLabelResolver, driverRecordShape, labelsToBackfill, onDemandDeparturesEnabled, resolveOnDemandDeparture, VehicleLabelResolver, type DriverLabel, type ResolvedOnDemandDeparture, type StoredDepartureLabels } from "../lib/onDemandDepartures";
import { fetchSpareDriver, fetchSpareDuty, fetchSparePage, fetchSpareVehicle, type SpareDutyRecord, type SpareSlotRecord } from "../lib/spareApi";

const DUTY_CONCURRENCY = 8;
// A duty has one start-location slot; a handful allows for re-planning.
const START_SLOT_LIMIT = 20;
// Today's and yesterday's duties, plus any older row still awaiting an
// actual. Well above a day of MVTA Connect duties; the cap is a safety stop
// against a runaway working set, not a sizing.
const MAX_DUTIES_PER_RUN = 400;

// Fleet numbers and driver names, remembered across runs for the life of the
// process.
const vehicleLabels = new VehicleLabelResolver(fetchSpareVehicle);

// Driver records that came back without a name, by shape (keys and which
// name fields were set), so each run can report a shape it has not seen
// before. Names are wanted and their absence is the thing to explain; the
// values themselves are never logged.
const unnamedDriverShapes = new Map<string, number>();
const reportedDriverShapes = new Set<string>();
const driverLabels = new DriverLabelResolver(async (driverId) => {
  const record = await fetchSpareDriver(driverId);
  if (!driverLabelFrom(record)?.name) {
    const shape = driverRecordShape(record);
    unnamedDriverShapes.set(shape, (unnamedDriverShapes.get(shape) ?? 0) + 1);
  }
  return record;
});

// How many rows in the console's window carry each label, for the run log.
async function labelCoverage(pool: sql.ConnectionPool, withVehicleIdentifier: boolean, withDriverLabel: boolean): Promise<string> {
  const request = pool.request();
  request.input("since", sql.Char(8), agencyServiceDate(new Date(), -30).serviceDate);
  const vehicle = withVehicleIdentifier ? "SUM(CASE WHEN vehicle_identifier IS NOT NULL THEN 1 ELSE 0 END)" : "NULL";
  const name = withDriverLabel ? "SUM(CASE WHEN driver_name IS NOT NULL THEN 1 ELSE 0 END)" : "NULL";
  const identifier = withDriverLabel ? "SUM(CASE WHEN driver_identifier IS NOT NULL THEN 1 ELSE 0 END)" : "NULL";
  const result = await request.query<{ rows: number; with_driver: number; with_vehicle: number; fleet: number | null; named: number | null; identified: number | null }>(`
    SELECT COUNT(*) AS rows,
      SUM(CASE WHEN driver_id IS NOT NULL THEN 1 ELSE 0 END) AS with_driver,
      SUM(CASE WHEN vehicle_id IS NOT NULL THEN 1 ELSE 0 END) AS with_vehicle,
      ${vehicle} AS fleet, ${name} AS named, ${identifier} AS identified
    FROM OnDemandDepartures WHERE service_date >= @since
  `);
  const c = result.recordset[0];
  return `${c.rows} rows in 30 days: ${c.with_driver} with a driver id, ${c.named ?? "n/a"} named, ${c.identified ?? "n/a"} with a driver identifier; ${c.with_vehicle} with a vehicle id, ${c.fleet ?? "n/a"} with a fleet number`;
}

// Rows stored before migrations 099 and 100 carry ids and no labels, and the
// working set never revisits a departed duty, so they would stay that way.
// Each run also labels a bounded batch of the newest such rows inside the
// console's longest window. Labels are conveniences, not source facts, so
// the update touches only the label columns and ignores source_updated_at.
const LABEL_BACKFILL_ROWS = 300;
const LABEL_BACKFILL_DAYS = 60;

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

async function upsert(
  pool: sql.ConnectionPool,
  departure: ResolvedOnDemandDeparture,
  serviceDate: string,
  vehicleIdentifier: string | null,
  withVehicleIdentifier: boolean,
  driverLabel: DriverLabel | null,
  withDriverLabel: boolean,
): Promise<void> {
  const request = pool.request();
  request.input("vehicle_identifier", sql.NVarChar(64), vehicleIdentifier);
  request.input("driver_name", sql.NVarChar(128), driverLabel?.name ?? null);
  request.input("driver_identifier", sql.NVarChar(64), driverLabel?.identifier ?? null);
  // Until migrations 099 and 100 land their columns do not exist; the
  // departure is still recorded, without its labels.
  const labelUpdate = (withVehicleIdentifier ? "vehicle_identifier = @vehicle_identifier," : "")
    + (withDriverLabel ? " driver_name = @driver_name, driver_identifier = @driver_identifier," : "");
  const labelColumn = (withVehicleIdentifier ? ", vehicle_identifier" : "") + (withDriverLabel ? ", driver_name, driver_identifier" : "");
  const labelValue = (withVehicleIdentifier ? ", @vehicle_identifier" : "") + (withDriverLabel ? ", @driver_name, @driver_identifier" : "");
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
        driver_id = @driver_id, vehicle_id = @vehicle_id, ${labelUpdate} duty_status = @duty_status,
        departure_scheduled = @departure_scheduled, scheduled_source = @scheduled_source,
        departure_actual = @departure_actual, departure_source = @departure_source,
        slot_id = @slot_id, source_updated_at = @source_updated_at, updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (
      duty_id, service_date, duty_identifier, driver_id, vehicle_id, duty_status,
      departure_scheduled, scheduled_source, departure_actual, departure_source, slot_id, source_updated_at${labelColumn}
    ) VALUES (
      @duty_id, @service_date, @duty_identifier, @driver_id, @vehicle_id, @duty_status,
      @departure_scheduled, @scheduled_source, @departure_actual, @departure_source, @slot_id, @source_updated_at${labelValue}
    );
  `);
}

type BackfillRow = StoredDepartureLabels & { duty_id: string };

export async function backfillLabels(
  pool: sql.ConnectionPool,
  withVehicleIdentifier: boolean,
  withDriverLabel: boolean,
  resolvers: { vehicle: (id: string) => Promise<string | null>; driver: (id: string) => Promise<DriverLabel | null> } = {
    vehicle: (id) => vehicleLabels.label(id),
    driver: (id) => driverLabels.label(id),
  },
): Promise<{ examined: number; labelled: number }> {
  if (!withVehicleIdentifier && !withDriverLabel) return { examined: 0, labelled: 0 };
  const wanting: string[] = [];
  if (withVehicleIdentifier) wanting.push("(vehicle_id IS NOT NULL AND vehicle_identifier IS NULL)");
  if (withDriverLabel) wanting.push("(driver_id IS NOT NULL AND driver_name IS NULL AND driver_identifier IS NULL)");
  const vehicleColumn = withVehicleIdentifier ? "vehicle_identifier" : "CAST(NULL AS NVARCHAR(64)) AS vehicle_identifier";
  const driverColumns = withDriverLabel
    ? "driver_name, driver_identifier"
    : "CAST(NULL AS NVARCHAR(128)) AS driver_name, CAST(NULL AS NVARCHAR(64)) AS driver_identifier";
  const request = pool.request();
  request.input("since", sql.Char(8), agencyServiceDate(new Date(), -LABEL_BACKFILL_DAYS).serviceDate);
  request.input("cap", sql.Int, LABEL_BACKFILL_ROWS);
  const result = await request.query<BackfillRow>(`
    SELECT TOP (@cap) duty_id, driver_id, vehicle_id, ${vehicleColumn}, ${driverColumns}
    FROM OnDemandDepartures
    WHERE service_date >= @since AND (${wanting.join(" OR ")})
    ORDER BY service_date DESC, duty_id
  `);
  let labelled = 0;
  for (const row of result.recordset) {
    const wants = labelsToBackfill(row, withVehicleIdentifier, withDriverLabel);
    const sets: string[] = [];
    const update = pool.request();
    update.input("duty_id", sql.NVarChar(64), row.duty_id);
    if (wants.vehicle && row.vehicle_id) {
      const label = await resolvers.vehicle(row.vehicle_id);
      if (label) { update.input("vehicle_identifier", sql.NVarChar(64), label); sets.push("vehicle_identifier = @vehicle_identifier"); }
    }
    if (wants.driver && row.driver_id) {
      const label = await resolvers.driver(row.driver_id);
      if (label) {
        update.input("driver_name", sql.NVarChar(128), label.name);
        update.input("driver_identifier", sql.NVarChar(64), label.identifier);
        sets.push("driver_name = @driver_name", "driver_identifier = @driver_identifier");
      }
    }
    if (sets.length === 0) continue;
    await update.query(`UPDATE OnDemandDepartures SET ${sets.join(", ")} WHERE duty_id = @duty_id`);
    labelled++;
  }
  return { examined: result.recordset.length, labelled };
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
    const ready = await pool.request().query<{ ready: number; with_vehicle_identifier: number; with_driver_label: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.OnDemandDepartures','U') IS NOT NULL
        AND OBJECT_ID('dbo.SpareMissedTripSource','U') IS NOT NULL THEN 1 ELSE 0 END ready,
        CASE WHEN COL_LENGTH('dbo.OnDemandDepartures','vehicle_identifier') IS NULL THEN 0 ELSE 1 END with_vehicle_identifier,
        CASE WHEN COL_LENGTH('dbo.OnDemandDepartures','driver_name') IS NULL THEN 0 ELSE 1 END with_driver_label
    `);
    if (!ready.recordset[0]?.ready) {
      context.warn("On-demand departures tables are not ready; migration 096 (and 028) may be pending.");
      return;
    }
    const withVehicleIdentifier = ready.recordset[0]?.with_vehicle_identifier === 1;
    if (!withVehicleIdentifier) context.warn("OnDemandDepartures has no vehicle_identifier column (migration 099); fleet numbers are not recorded.");
    const withDriverLabel = ready.recordset[0]?.with_driver_label === 1;
    if (!withDriverLabel) context.warn("OnDemandDepartures has no driver_name column (migration 100); driver names are not recorded.");

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
          const vehicleIdentifier = withVehicleIdentifier && departure.vehicleId ? await vehicleLabels.label(departure.vehicleId) : null;
          const driverLabel = withDriverLabel && departure.driverId ? await driverLabels.label(departure.driverId) : null;
          await upsert(pool, departure, serviceDate, vehicleIdentifier, withVehicleIdentifier, driverLabel, withDriverLabel);
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

    // After the feed's health is settled: a label backfill that fails must
    // not read as a departures feed that failed.
    try {
      const backfill = await backfillLabels(pool, withVehicleIdentifier, withDriverLabel);
      context.log(`On-demand departures label backfill: ${backfill.examined} rows examined, ${backfill.labelled} labelled (newest first, last ${LABEL_BACKFILL_DAYS} days). Coverage: ${await labelCoverage(pool, withVehicleIdentifier, withDriverLabel)}.`);
    } catch (err) {
      context.warn(`On-demand departures label backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const [shape, count] of unnamedDriverShapes) {
      if (reportedDriverShapes.has(shape)) continue;
      reportedDriverShapes.add(shape);
      context.warn(`On-demand departures: ${count} Spare driver record(s) carried no name; shape ${shape}.`);
    }
  },
});
