// Bounded, idempotent Spare ingestion for Missed Trips only. Requests is the
// primary trip/lateness/cancellation feed; Slots supplies the same-duty order
// needed for the supersession condition. Rider/contact/location fields are
// deliberately neither logged nor stored.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { recordMissedTripFeedSuccess } from "../lib/missedTripFeedHealth";
import {
  fetchSparePage,
  spareNumber,
  spareServiceName,
  spareString,
  spareTimestamp,
  type SpareRequestRecord,
  type SpareSlotRecord,
} from "../lib/spareApi";
import { normalizeOnDemandSpareRequest } from "../lib/onDemandSpareMonitor";
import { loadActiveOperationalZones, storeOnDemandSpareRequest } from "../lib/onDemandSpareMonitorStore";

const REQUEST_PAGE_SIZE = 200;
const SLOT_PAGE_SIZE = 200;
const SLOT_DUTY_CONCURRENCY = 8;
const DEFAULT_LOOKBACK_MINUTES = 120;
const DEFAULT_MAX_ROWS = 10_000;

function enabled(): boolean {
  return process.env.SPARE_MISSED_TRIPS_ENABLED?.trim().toLowerCase() === "true";
}

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? "");
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function scopedServiceIds(): ReadonlySet<string> {
  return new Set(
    (process.env.SPARE_MISSED_TRIP_SERVICE_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

async function fetchUpdated<T>(
  path: "/v1/requests",
  fromSeconds: number,
  toSeconds: number,
  pageSize: number,
  maxRows: number,
): Promise<T[]> {
  const rows: T[] = [];
  let skip = 0;
  let reportedTotal = 0;
  while (rows.length < maxRows) {
    const query = new URLSearchParams({
      fromUpdatedAt: String(fromSeconds),
      toUpdatedAt: String(toSeconds),
      orderBy: "updatedAt",
      orderDirection: "ASC",
      limit: String(Math.min(pageSize, maxRows - rows.length)),
      skip: String(skip),
    });
    const page = await fetchSparePage<T>(path, query);
    reportedTotal = page.total;
    rows.push(...page.data);
    skip += page.data.length;
    if (page.data.length === 0 || skip >= page.total) break;
    if (skip > 50_000) throw new Error(`Spare ${path} pagination exceeded the documented skip limit`);
  }
  if (rows.length >= maxRows && reportedTotal > rows.length) {
    throw new Error(`Spare ${path} update window exceeded the ${maxRows}-row safety cap`);
  }
  return rows;
}

async function fetchPickupSlotsForDuty(
  dutyId: string,
  maxRows: number,
): Promise<SpareSlotRecord[]> {
  const rows: SpareSlotRecord[] = [];
  let skip = 0;
  let reportedTotal = 0;
  while (rows.length < maxRows) {
    const query = new URLSearchParams({
      dutyId,
      type: "pickup",
      orderBy: "updatedAt",
      orderDirection: "ASC",
      limit: String(Math.min(SLOT_PAGE_SIZE, maxRows - rows.length)),
      skip: String(skip),
    });
    const page = await fetchSparePage<SpareSlotRecord>("/v1/slots", query);
    reportedTotal = page.total;
    rows.push(...page.data);
    skip += page.data.length;
    if (page.data.length === 0 || skip >= page.total) break;
    if (skip > 50_000) throw new Error("Spare /v1/slots duty pagination exceeded the documented skip limit");
  }
  if (rows.length >= maxRows && reportedTotal > rows.length) {
    throw new Error(`Spare /v1/slots duty ${dutyId} exceeded the ${maxRows}-row safety cap`);
  }
  return rows;
}

export async function fetchSlotsForRequestDuties(
  requests: readonly SpareRequestRecord[],
  maxRows: number,
  fetchSlots: (dutyId: string, rowsPerDuty: number) => Promise<SpareSlotRecord[]> = fetchPickupSlotsForDuty,
): Promise<SpareSlotRecord[]> {
  const dutyIds = [...new Set(requests.flatMap((row) => {
    const dutyId = spareString(row.dutyId, 64) ?? spareString(row.lockedToDutyId, 64);
    return dutyId ? [dutyId] : [];
  }))];
  const rowsPerDuty = Math.max(1, Math.floor(maxRows / Math.max(1, dutyIds.length)));
  const slots: SpareSlotRecord[] = [];
  for (let index = 0; index < dutyIds.length; index += SLOT_DUTY_CONCURRENCY) {
    const batches = await Promise.all(dutyIds.slice(index, index + SLOT_DUTY_CONCURRENCY)
      .map((dutyId) => fetchSlots(dutyId, rowsPerDuty)));
    slots.push(...batches.flat());
  }
  return slots;
}

async function upsertRequest(pool: sql.ConnectionPool, row: SpareRequestRecord): Promise<boolean> {
  const requestId = spareString(row.id, 64);
  const status = spareString(row.status, 32);
  const serviceId = spareString(row.serviceId, 64);
  if (!requestId || !status) return false;
  const scope = scopedServiceIds();
  if (scope.size > 0 && (!serviceId || !scope.has(serviceId))) return false;

  const dutyId = spareString(row.dutyId, 64) ?? spareString(row.lockedToDutyId, 64);
  const sourceUpdatedAt = spareTimestamp(row.updatedAt);
  if (!sourceUpdatedAt) return false;
  const scheduledPickupAt = spareTimestamp(row.scheduledPickupTs);
  const pickupArrivedAt = spareTimestamp(row.pickupArrivedTs);
  const scheduledDropoffAt = spareTimestamp(row.scheduledDropoffTs);
  const dropoffArrivedAt = spareTimestamp(row.dropoffArrivedTs);
  const cancellationFault = spareString(row.cancellationDetails?.fault, 64);
  const cancellationReason = spareString(row.cancellationDetails?.reason, 128);
  const sanitizedEvidence = JSON.stringify({
    requestId,
    status,
    dutyId,
    serviceId,
    scheduledPickupTs: spareNumber(row.scheduledPickupTs),
    pickupArrivedTs: spareNumber(row.pickupArrivedTs),
    scheduledDropoffTs: spareNumber(row.scheduledDropoffTs),
    dropoffArrivedTs: spareNumber(row.dropoffArrivedTs),
    pickupLateness: spareNumber(row.lateness?.pickupLateness),
    dropoffLateness: spareNumber(row.lateness?.dropoffLateness),
    cancellationFault,
    cancellationReason,
    sourceUpdatedAt: spareNumber(row.updatedAt),
  });

  const req = pool.request();
  req.input("request_id", sql.NVarChar(64), requestId);
  req.input("duty_id", sql.NVarChar(64), dutyId);
  req.input("service_id", sql.NVarChar(64), serviceId);
  req.input("service_name", sql.NVarChar(128), spareServiceName(row.serviceBrand));
  req.input("status", sql.NVarChar(32), status);
  req.input("original_scheduled_pickup_at", sql.DateTime2, spareTimestamp(row.initialScheduledPickupTs));
  req.input("scheduled_pickup_at", sql.DateTime2, scheduledPickupAt);
  req.input("pickup_arrived_at", sql.DateTime2, pickupArrivedAt);
  req.input("pickup_lateness_seconds", sql.Int, spareNumber(row.lateness?.pickupLateness));
  req.input("original_scheduled_dropoff_at", sql.DateTime2, spareTimestamp(row.initialScheduledDropoffTs));
  req.input("scheduled_dropoff_at", sql.DateTime2, scheduledDropoffAt);
  req.input("dropoff_arrived_at", sql.DateTime2, dropoffArrivedAt);
  req.input("dropoff_lateness_seconds", sql.Int, spareNumber(row.lateness?.dropoffLateness));
  // Requests exposes attribution but not a single canonical cancellation
  // timestamp; do not substitute updatedAt and present it as an event time.
  req.input("cancelled_at", sql.DateTime2, null);
  req.input("cancellation_fault", sql.NVarChar(64), cancellationFault);
  req.input("cancellation_reason", sql.NVarChar(128), cancellationReason);
  req.input("source_updated_at", sql.DateTime2, sourceUpdatedAt);
  req.input("raw_payload", sql.NVarChar(sql.MAX), sanitizedEvidence);
  await req.query(`
    MERGE SpareMissedTripSource WITH (HOLDLOCK) AS target
    USING (SELECT @request_id AS request_id) AS src
    ON target.request_id = src.request_id
    WHEN MATCHED AND (target.source_updated_at IS NULL OR @source_updated_at IS NULL OR @source_updated_at >= target.source_updated_at)
      THEN UPDATE SET
        duty_id = @duty_id, service_id = @service_id, service_name = @service_name,
        status = @status,
        original_scheduled_pickup_at = @original_scheduled_pickup_at,
        scheduled_pickup_at = @scheduled_pickup_at, pickup_arrived_at = @pickup_arrived_at,
        pickup_lateness_seconds = @pickup_lateness_seconds,
        original_scheduled_dropoff_at = @original_scheduled_dropoff_at,
        scheduled_dropoff_at = @scheduled_dropoff_at, dropoff_arrived_at = @dropoff_arrived_at,
        dropoff_lateness_seconds = @dropoff_lateness_seconds,
        cancelled_at = @cancelled_at, cancellation_fault = @cancellation_fault,
        cancellation_reason = @cancellation_reason, source_updated_at = @source_updated_at,
        ingested_at = SYSUTCDATETIME(), raw_payload = @raw_payload
    WHEN NOT MATCHED THEN INSERT (
      request_id, duty_id, service_id, service_name, status,
      original_scheduled_pickup_at, scheduled_pickup_at, pickup_arrived_at, pickup_lateness_seconds,
      original_scheduled_dropoff_at, scheduled_dropoff_at, dropoff_arrived_at, dropoff_lateness_seconds,
      cancelled_at, cancellation_fault, cancellation_reason, source_updated_at, raw_payload
    ) VALUES (
      @request_id, @duty_id, @service_id, @service_name, @status,
      @original_scheduled_pickup_at, @scheduled_pickup_at, @pickup_arrived_at, @pickup_lateness_seconds,
      @original_scheduled_dropoff_at, @scheduled_dropoff_at, @dropoff_arrived_at, @dropoff_lateness_seconds,
      @cancelled_at, @cancellation_fault, @cancellation_reason, @source_updated_at, @raw_payload
    );
  `);
  return true;
}

async function upsertSlot(pool: sql.ConnectionPool, row: SpareSlotRecord): Promise<boolean> {
  const slotId = spareString(row.id, 64);
  const dutyId = spareString(row.dutyId, 64);
  const slotType = spareString(row.type, 32);
  if (!slotId || !dutyId || !slotType) return false;
  const sourceUpdatedAt = spareTimestamp(row.updatedAt);
  if (!sourceUpdatedAt) return false;
  const sanitizedEvidence = JSON.stringify({
    slotId,
    dutyId,
    requestId: spareString(row.requestId, 64),
    type: slotType,
    status: spareString(row.status, 32),
    scheduledTs: spareNumber(row.scheduledTs),
    startedTs: spareNumber(row.startedTs),
    arrivedTs: spareNumber(row.arrivedTs),
    completedTs: spareNumber(row.completedTs),
    cancelledTs: spareNumber(row.cancelledTs),
    sourceUpdatedAt: spareNumber(row.updatedAt),
  });
  const req = pool.request();
  req.input("slot_id", sql.NVarChar(64), slotId);
  req.input("duty_id", sql.NVarChar(64), dutyId);
  req.input("request_id", sql.NVarChar(64), spareString(row.requestId, 64));
  req.input("slot_type", sql.NVarChar(32), slotType);
  req.input("status", sql.NVarChar(32), spareString(row.status, 32));
  req.input("scheduled_at", sql.DateTime2, spareTimestamp(row.scheduledTs));
  req.input("started_at", sql.DateTime2, spareTimestamp(row.startedTs));
  req.input("arrived_at", sql.DateTime2, spareTimestamp(row.arrivedTs));
  req.input("completed_at", sql.DateTime2, spareTimestamp(row.completedTs));
  req.input("cancelled_at", sql.DateTime2, spareTimestamp(row.cancelledTs));
  req.input("source_updated_at", sql.DateTime2, sourceUpdatedAt);
  req.input("raw_payload", sql.NVarChar(sql.MAX), sanitizedEvidence);
  await req.query(`
    MERGE SpareMissedTripSlots WITH (HOLDLOCK) AS target
    USING (SELECT @slot_id AS slot_id) AS src
    ON target.slot_id = src.slot_id
    WHEN MATCHED AND (target.source_updated_at IS NULL OR @source_updated_at IS NULL OR @source_updated_at >= target.source_updated_at)
      THEN UPDATE SET
        duty_id = @duty_id, request_id = @request_id, slot_type = @slot_type,
        status = @status, scheduled_at = @scheduled_at, started_at = @started_at,
        arrived_at = @arrived_at, completed_at = @completed_at, cancelled_at = @cancelled_at,
        source_updated_at = @source_updated_at, ingested_at = SYSUTCDATETIME(), raw_payload = @raw_payload
    WHEN NOT MATCHED THEN INSERT (
      slot_id, duty_id, request_id, slot_type, status, scheduled_at,
      started_at, arrived_at, completed_at, cancelled_at, source_updated_at, raw_payload
    ) VALUES (
      @slot_id, @duty_id, @request_id, @slot_type, @status, @scheduled_at,
      @started_at, @arrived_at, @completed_at, @cancelled_at, @source_updated_at, @raw_payload
    );
  `);
  return true;
}

app.timer("spareMissedTripsIngest", {
  schedule: "0 2/15 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    if (!enabled()) {
      context.log("Spare missed-trip ingestion is disabled (SPARE_MISSED_TRIPS_ENABLED is not true).");
      return;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const lookbackMinutes = positiveInteger("SPARE_MISSED_TRIP_LOOKBACK_MINUTES", DEFAULT_LOOKBACK_MINUTES, 7 * 24 * 60);
    const maxRows = positiveInteger("SPARE_MISSED_TRIP_MAX_ROWS", DEFAULT_MAX_ROWS, 50_000);
    const fromSeconds = nowSeconds - lookbackMinutes * 60;
    const requests = await fetchUpdated<SpareRequestRecord>("/v1/requests", fromSeconds, nowSeconds, REQUEST_PAGE_SIZE, maxRows);
    const slots = await fetchSlotsForRequestDuties(requests, maxRows);
    const pool = await getPool();
    const activeZones = await loadActiveOperationalZones();
    let requestWrites = 0;
    let slotWrites = 0;
    let monitorWrites = 0;
    for (const row of requests) {
      if (await upsertRequest(pool, row)) {
        requestWrites++;
        const normalized = normalizeOnDemandSpareRequest(row);
        if (normalized && await storeOnDemandSpareRequest(normalized, activeZones)) monitorWrites++;
      }
    }
    for (const row of slots) if (await upsertSlot(pool, row)) slotWrites++;
    const maxRequestUpdatedAt = requests.reduce((max, row) => Math.max(max, spareNumber(row.updatedAt) ?? 0), 0);
    const maxSlotUpdatedAt = slots.reduce((max, row) => Math.max(max, spareNumber(row.updatedAt) ?? 0), 0);
    await recordMissedTripFeedSuccess(pool, "spare_requests", requestWrites, maxRequestUpdatedAt || null);
    await recordMissedTripFeedSuccess(pool, "spare_slots", slotWrites, maxSlotUpdatedAt || null);
    context.log(
      `Spare Missed Trips ingestion: ${requests.length} requests fetched/${requestWrites} stored; ` +
        `${slots.length} slots fetched/${slotWrites} stored; ${monitorWrites} on-demand monitor updates.`,
    );
  },
});
