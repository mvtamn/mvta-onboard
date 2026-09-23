import { resolveOperationalZone, type OperationalZoneSnapshot } from "./onDemandOperationalZones";
import { getPool, sql } from "./db";
import type { SpareDutyMatchingUpdate, SpareDutyVehicleUpdate } from "./onDemandSpareMonitor";
import type { MonitoredOnDemandRequest } from "./onDemandRequestSource";
import { CachedValue } from "./spareWebhookIntake";

type ActiveZoneRow = {
  id: string;
  external_location_id: string;
  name: string;
  feed_version: string;
  geometry_json: string;
};

export interface ActiveOperationalZones {
  snapshot: OperationalZoneSnapshot;
  databaseIds: ReadonlyMap<string, string>;
}

export async function loadActiveOperationalZones(): Promise<ActiveOperationalZones> {
  const rows = await (await getPool()).request().query<ActiveZoneRow>(`
    SELECT z.id, z.external_location_id, z.name, z.geometry_json, v.feed_version
    FROM dbo.OnDemandOperationalZones z
    JOIN dbo.OnDemandOperationalZoneVersions v ON v.id = z.zone_version_id AND v.is_active = 1
  `);
  const zones = rows.recordset.map((row) => ({
    externalLocationId: row.external_location_id,
    name: row.name,
    version: row.feed_version,
    geometry: JSON.parse(row.geometry_json),
  }));
  return {
    snapshot: { version: zones[0]?.version ?? "", zones },
    databaseIds: new Map(rows.recordset.map((row) => [row.external_location_id, row.id])),
  };
}

// The active zones change when a zone version is activated, which is rare
// and deliberate; the webhook receiver was re-reading them for every one of
// thousands of deliveries an hour. One read a minute is current enough for
// monitoring, and a failed refresh serves the last good set rather than
// failing every delivery in the meantime. Timers and reads that need the
// very latest version keep calling loadActiveOperationalZones directly.
const activeZonesCache = new CachedValue(loadActiveOperationalZones, 60_000);

export function loadActiveOperationalZonesCached(): Promise<ActiveOperationalZones> {
  return activeZonesCache.get();
}

// applied: the monitor row changed. unchanged: the source record was no newer
// than the row already held, or the request had already left the active state.
// no_active_zones: nothing was written because no zone version is active.
export type OnDemandStoreOutcome = "applied" | "unchanged" | "no_active_zones";

// Accepts only a request onDemandRequestSource has admitted to the monitored
// scope, so scope needs no re-check here.
//
// A missing active zone version is reported, not thrown. It is a configuration
// gap every caller meets on every record, and what it means differs by caller:
// the authoritative reconciliation records it as a feed failure, while the
// webhook and the missed-trip ingest skip the monitor write and carry on - a
// throw from here once armed the webhook intake gate's cool-down and shed
// unrelated deliveries (#181), and took down the missed-trip ingest that does
// not need zones at all (2026-09-03).
export async function storeOnDemandSpareRequest(
  input: MonitoredOnDemandRequest,
  activeZones: ActiveOperationalZones,
  now = new Date(),
): Promise<OnDemandStoreOutcome> {
  if (!activeZones.snapshot.zones.length) return "no_active_zones";
  const resolved = resolveOperationalZone(activeZones.snapshot, input.pickupCoordinate);
  const zoneId = resolved.kind === "assigned" ? resolved.zone.externalLocationId : "Unzoned";
  const zoneDbId = resolved.kind === "assigned" ? activeZones.databaseIds.get(zoneId) ?? null : null;
  const zoneResolution = resolved.kind === "assigned" ? "assigned" : resolved.reason;
  const currentWait = Math.max(0, Math.floor((now.getTime() - input.commitmentAt.getTime()) / 60_000));
  const predictedWait = input.predictedPickupAt
    ? Math.max(0, Math.floor((input.predictedPickupAt.getTime() - input.commitmentAt.getTime()) / 60_000))
    : null;
  const reasons = [
    ...(currentWait > 0 ? ["Observed: pickup commitment is overdue."] : []),
    ...(predictedWait !== null && predictedWait > 0 ? ["Projected: updated pickup estimate is after the commitment."] : []),
    ...(resolved.kind === "assigned" ? [] : [`Monitoring incomplete: ${zoneResolution.replaceAll("_", " ")}.`]),
  ];
  const request = (await getPool()).request();
  request.input("request_id", sql.NVarChar(100), input.requestId);
  request.input("duty_id", sql.NVarChar(100), input.dutyId);
  request.input("vehicle_id", sql.NVarChar(100), input.vehicleId);
  request.input("zone_id", sql.NVarChar(100), zoneId);
  request.input("zone_db_id", sql.UniqueIdentifier, zoneDbId);
  request.input("zone_resolution", sql.NVarChar(40), zoneResolution);
  request.input("source_updated_at", sql.DateTime2, input.sourceUpdatedAt);
  request.input("initial_pickup_at", sql.DateTime2, input.originalPickupAt);
  request.input("scheduled_pickup_at", sql.DateTime2, input.commitmentAt);
  request.input("predicted_pickup_at", sql.DateTime2, input.predictedPickupAt);
  request.input("pickup_arrived_at", sql.DateTime2, input.pickupArrivedAt);
  request.input("current_wait_minutes", sql.Int, currentWait);
  request.input("predicted_wait_minutes", sql.Int, predictedWait);
  request.input("monitor_state", sql.NVarChar(20), input.state);
  request.input("reasons", sql.NVarChar(sql.MAX), JSON.stringify(reasons));
  const result = await request.query<{ applied: boolean }>(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    DECLARE @changes TABLE (action NVARCHAR(10));
    DECLARE @assigned_vehicle_id NVARCHAR(100) = COALESCE(@vehicle_id, (SELECT vehicle_id FROM dbo.OnDemandSpareDuties WHERE duty_id = @duty_id));
    MERGE dbo.MonitoredOnDemandWaits WITH (HOLDLOCK) AS target
    USING (SELECT @request_id AS trip_id) AS source ON target.trip_id = source.trip_id
    WHEN MATCHED AND target.monitor_state = 'active'
      AND (target.source_updated_at IS NULL OR @source_updated_at > target.source_updated_at)
      THEN UPDATE SET
        external_trip_id = @request_id, zone_id = @zone_id, wait_started_at = @scheduled_pickup_at,
        predicted_pickup_at = @predicted_pickup_at, current_wait_minutes = @current_wait_minutes,
        predicted_wait_minutes = @predicted_wait_minutes, assigned_vehicle_id = @assigned_vehicle_id,
        trend = 'stable', prediction_confidence = CASE WHEN @predicted_pickup_at IS NULL THEN 'low' ELSE 'medium' END,
        prediction_reasons = @reasons, source_updated_at = @source_updated_at, last_polled_at = SYSUTCDATETIME(),
        monitor_state = @monitor_state, duty_id = @duty_id, initial_scheduled_pickup_at = @initial_pickup_at,
        scheduled_pickup_at = @scheduled_pickup_at, pickup_arrived_at = @pickup_arrived_at, zone_resolution = @zone_resolution
    WHEN NOT MATCHED THEN INSERT (
      trip_id, external_trip_id, zone_id, wait_started_at, predicted_pickup_at, current_wait_minutes,
      predicted_wait_minutes, assigned_vehicle_id, trend, prediction_confidence, prediction_reasons,
      source_updated_at, last_polled_at, monitor_state, duty_id, initial_scheduled_pickup_at,
      scheduled_pickup_at, pickup_arrived_at, zone_resolution
    ) VALUES (
      @request_id, @request_id, @zone_id, @scheduled_pickup_at, @predicted_pickup_at, @current_wait_minutes,
      @predicted_wait_minutes, @assigned_vehicle_id, 'stable', CASE WHEN @predicted_pickup_at IS NULL THEN 'low' ELSE 'medium' END, @reasons,
      @source_updated_at, SYSUTCDATETIME(), @monitor_state, @duty_id, @initial_pickup_at,
      @scheduled_pickup_at, @pickup_arrived_at, @zone_resolution
    )
    OUTPUT $action INTO @changes;
    IF EXISTS (SELECT 1 FROM @changes) BEGIN
      INSERT INTO dbo.OnDemandRequestCommitmentAudit (
        request_id, source_updated_at, initial_scheduled_pickup_at, scheduled_pickup_at
      ) VALUES (@request_id, @source_updated_at, @initial_pickup_at, @scheduled_pickup_at);
      MERGE dbo.OnDemandRequestZoneSnapshots WITH (HOLDLOCK) AS target
      USING (
        SELECT @request_id AS request_id, v.id AS zone_version_id, @zone_db_id AS zone_id, @zone_resolution AS resolution
        FROM dbo.OnDemandOperationalZoneVersions v WHERE v.is_active = 1
      ) AS source ON target.request_id = source.request_id
      WHEN MATCHED THEN UPDATE SET zone_version_id = source.zone_version_id, zone_id = source.zone_id, resolution = source.resolution, assigned_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (request_id, zone_version_id, zone_id, resolution) VALUES (source.request_id, source.zone_version_id, source.zone_id, source.resolution);
    END
    UPDATE dbo.MonitoredOnDemandWaits
    SET last_polled_at = SYSUTCDATETIME()
    WHERE trip_id = @request_id AND monitor_state = @monitor_state;
    COMMIT;
    SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM @changes) THEN 1 ELSE 0 END AS bit) AS applied;
  `);
  return result.recordset[0]?.applied ? "applied" : "unchanged";
}

// Which of these request ids the monitor is currently tracking. Used by the
// webhook receiver to decide whether an ETA delivery is worth an outbound read
// of the request from Spare.
export async function monitoredRequestIds(requestIds: readonly string[]): Promise<Set<string>> {
  if (requestIds.length === 0) return new Set();
  const request = (await getPool()).request();
  const names = requestIds.map((id, index) => {
    request.input(`id${index}`, sql.NVarChar(100), id);
    return `@id${index}`;
  });
  const rows = await request.query<{ trip_id: string }>(`
    SELECT trip_id FROM dbo.MonitoredOnDemandWaits
    WHERE monitor_state = 'active' AND trip_id IN (${names.join(", ")})
  `);
  return new Set(rows.recordset.map((row) => row.trip_id));
}

export async function storeSpareDutyVehicle(update: SpareDutyVehicleUpdate): Promise<void> {
  const request = (await getPool()).request();
  request.input("duty_id", sql.NVarChar(100), update.dutyId);
  request.input("vehicle_id", sql.NVarChar(100), update.vehicleId);
  request.input("updated_at", sql.DateTime2, update.updatedAt);
  await request.query(`
    MERGE dbo.OnDemandSpareDuties WITH (HOLDLOCK) AS target
    USING (SELECT @duty_id AS duty_id) AS source ON target.duty_id = source.duty_id
    WHEN MATCHED AND (target.vehicle_source_updated_at IS NULL OR @updated_at > target.vehicle_source_updated_at)
      THEN UPDATE SET vehicle_id = @vehicle_id, vehicle_source_updated_at = @updated_at, updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (duty_id, vehicle_id, vehicle_source_updated_at) VALUES (@duty_id, @vehicle_id, @updated_at);
    UPDATE m SET assigned_vehicle_id = d.vehicle_id, last_polled_at = SYSUTCDATETIME()
      FROM dbo.MonitoredOnDemandWaits m
      JOIN dbo.OnDemandSpareDuties d ON d.duty_id = m.duty_id
      WHERE m.duty_id = @duty_id AND m.monitor_state = 'active' AND d.vehicle_source_updated_at = @updated_at;
  `);
}

export async function storeSpareDutyMatching(update: SpareDutyMatchingUpdate): Promise<void> {
  const request = (await getPool()).request();
  request.input("duty_id", sql.NVarChar(100), update.dutyId);
  request.input("is_matching_enabled", sql.Bit, update.isMatchingEnabled);
  await request.query(`
    MERGE dbo.OnDemandSpareDuties WITH (HOLDLOCK) AS target
    USING (SELECT @duty_id AS duty_id) AS source ON target.duty_id = source.duty_id
    WHEN MATCHED THEN UPDATE SET is_matching_enabled = @is_matching_enabled, matching_updated_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (duty_id, is_matching_enabled, matching_updated_at) VALUES (@duty_id, @is_matching_enabled, SYSUTCDATETIME());
  `);
}
