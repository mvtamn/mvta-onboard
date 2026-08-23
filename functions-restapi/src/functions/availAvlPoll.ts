// Timer-triggered ingestion of Avail's proprietary AVL Reports API - a
// separate vehicle-location source from the GTFS-Realtime VehiclePosition
// feed (gtfsVehiclePositionsPoll.ts). Purely monitoring data, same as that
// poller: no alerting concept, nothing here ever escalates into
// SuggestedAlerts. Upserts one row per vehicle (its latest known position)
// into AvailAvlVehiclePositions, keyed by Avail's own vehicle_id.
//
// The same shared fetch can feed event projection when its independent lease
// is due. The event path never creates a second Avail polling stream.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchAvlReports, mapAvlReport } from "../lib/availAvl";
import { detectEventGeofenceCrossings } from "../lib/eventGeofenceDetection";
import { detectMonitoringAreaTests } from "../lib/monitoringAreaTest";
import { detectionWindowSeconds, shouldAcceptObservation } from "../lib/eventProcessing";
import { recordEventHealth, recordTelemetryDiagnostic } from "../lib/eventHealth";

type PollPool = Awaited<ReturnType<typeof getPool>>;

async function safeHealth(
  pool: PollPool,
  component: Parameters<typeof recordEventHealth>[1],
  status: Parameters<typeof recordEventHealth>[2],
  detail?: string,
  error?: unknown,
): Promise<void> {
  try {
    await recordEventHealth(pool, component, status, detail, error);
  } catch (healthError) {
    // Telemetry must never take down the ingestion path it describes.
    console.warn(`Unable to record ${component} health`, healthError);
  }
}

async function safeDiagnostic(
  pool: PollPool,
  component: Parameters<typeof recordTelemetryDiagnostic>[1],
  reason: string,
  detail: string,
  vehicleId?: number,
): Promise<void> {
  try {
    await recordTelemetryDiagnostic(pool, component, reason, detail, vehicleId);
  } catch (diagnosticError) {
    console.warn(`Unable to record ${component} diagnostic`, diagnosticError);
  }
}

async function claimPollLease(pool: Awaited<ReturnType<typeof getPool>>, moduleName: string, settingKey: string, fallbackSeconds: number): Promise<boolean> {
  const request = pool.request();
  request.input("module", sql.NVarChar, moduleName);
  request.input("settingKey", sql.NVarChar, settingKey);
  request.input("fallback", sql.Int, fallbackSeconds);
  const lease = await request.query<{ claimed: number }>(`
    DECLARE @interval INT = COALESCE((
      SELECT TRY_CONVERT(INT, setting_value) FROM AppSettings
      WHERE module = @module AND setting_key = @settingKey
    ), @fallback);
    SET @interval = CASE WHEN @interval < 15 THEN 15 WHEN @interval > 300 THEN 300 ELSE @interval END;
    UPDATE AppPollState WITH (UPDLOCK, HOLDLOCK)
    SET last_run_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
    OUTPUT 1 AS claimed
    WHERE module = @module
      AND (last_run_at IS NULL OR last_run_at <= DATEADD(SECOND, -@interval, SYSUTCDATETIME()));
  `);
  return lease.recordset.length > 0;
}

export function eventVehicleProjectionSql(): string {
  return `
    SELECT avl.vehicle_id, avl.route, avl.latitude, avl.longitude, avl.heading, avl.report_timestamp
    FROM AvailAvlVehiclePositions avl
    WHERE avl.report_timestamp >= DATEADD(SECOND, -@windowSeconds, SYSUTCDATETIME())
  `;
}

async function projectEventPositions(pool: Awaited<ReturnType<typeof getPool>>): Promise<void> {
  const interval = (await pool.request().query<{ seconds: number }>(`
    SELECT COALESCE(TRY_CONVERT(INT, setting_value), 30) seconds
    FROM AppSettings WHERE module = 'event' AND setting_key = 'poll_interval_seconds'
  `)).recordset[0]?.seconds ?? 30;
  const windowSeconds = detectionWindowSeconds(interval);
  const query = pool.request();
  query.input("windowSeconds", sql.Int, windowSeconds);
  const rows = (await query.query<{
    vehicle_id: number; route: number | null; latitude: number; longitude: number;
    heading: number | null; report_timestamp: Date;
  }>(eventVehicleProjectionSql())).recordset;
  for (const row of rows) {
    const current = (await pool.request().input("vehicle", sql.Int, row.vehicle_id).query<{ report_timestamp: Date }>(
      "SELECT report_timestamp FROM EventVehicleCurrentPosition WHERE vehicle_id=@vehicle",
    )).recordset[0];
    if (!shouldAcceptObservation(current, row)) continue;
    const request = pool.request();
    request.input("vehicle_id", sql.Int, row.vehicle_id); request.input("route", sql.Int, row.route);
    request.input("latitude", sql.Float, row.latitude); request.input("longitude", sql.Float, row.longitude);
    request.input("heading", sql.Float, row.heading); request.input("report_timestamp", sql.DateTime2, row.report_timestamp);
    await request.query(`
      MERGE EventVehicleCurrentPosition WITH (HOLDLOCK) AS target
      USING (SELECT @vehicle_id AS vehicle_id) AS src ON target.vehicle_id = src.vehicle_id
      WHEN MATCHED THEN UPDATE SET route=@route, latitude=@latitude, longitude=@longitude,
        heading=@heading, report_timestamp=@report_timestamp, updated_at=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT(vehicle_id,route,latitude,longitude,heading,report_timestamp)
        VALUES(@vehicle_id,@route,@latitude,@longitude,@heading,@report_timestamp);
      IF NOT EXISTS (SELECT 1 FROM EventVehiclePositionHistory WHERE vehicle_id=@vehicle_id AND report_timestamp=@report_timestamp)
        INSERT INTO EventVehiclePositionHistory(vehicle_id,route,latitude,longitude,heading,report_timestamp)
        VALUES(@vehicle_id,@route,@latitude,@longitude,@heading,@report_timestamp);
    `);
  }
}

app.timer("availAvlPoll", {
  // Fixed floor cadence; the Admin-managed effective interval is checked
  // atomically below. Azure timer CRON cannot be changed without redeploying.
  schedule: "*/15 * * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const baseUrl = process.env.AVAIL_AVL_REPORTS_URL;
    const apiKey = process.env.AVAIL_AVL_REPORTS_API_KEY;
    if (!baseUrl || !apiKey) {
      context.warn("AVAIL_AVL_REPORTS_URL/AVAIL_AVL_REPORTS_API_KEY are not configured - skipping this run.");
      return;
    }

    const pool = await getPool();
    const settingsReady = await pool.request().query<{ ready: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.AppSettings', 'U') IS NOT NULL
                    AND OBJECT_ID('dbo.AppPollState', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ready
    `);
    let sharedDue = true;
    let eventDue = true;
    if (settingsReady.recordset[0]?.ready === 1) {
      sharedDue = await claimPollLease(pool, "avail", "poll_interval_seconds", 30);
      eventDue = await claimPollLease(pool, "event", "poll_interval_seconds", 30);
    }
    if (!sharedDue && !eventDue) return;

    // Keep a two-minute overlap so delayed reports are not lost while the
    // monitoring UI refreshes every 30 seconds.
    // This remains well under the feed's 24-hour maximum window.
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    let reports: Awaited<ReturnType<typeof fetchAvlReports>> = [];
    if (sharedDue) {
      try {
        reports = await fetchAvlReports(baseUrl, apiKey, twoMinutesAgo, now);
        await safeHealth(pool, "shared_avl_ingestion", "healthy", `Fetched ${reports.length} reports.`);
      } catch (err) {
        context.error("Failed to fetch Avail AVL Reports:", err);
        await safeHealth(pool, "shared_avl_ingestion", "failed", "Avail AVL fetch failed.", err);
        return;
      }
    }

    const tableCheck = await pool.request().query<{ table_exists: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.EventVehicleCurrentPosition', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
    `);

    let upsertedCount = 0;

    for (const report of sharedDue ? reports : []) {
      let mapped;
      try {
        mapped = mapAvlReport(report);
      } catch (err) {
        context.error(`Failed to map Avail AVL report for vehicle ${report.Vehicle}:`, err);
        await safeDiagnostic(pool, "shared_avl_ingestion", "invalid_report", "Avail AVL report could not be mapped.", Number(report.Vehicle));
        continue;
      }
      if (!mapped) {
        await safeDiagnostic(pool, "shared_avl_ingestion", "invalid_report", "Avail AVL report was missing usable position data.", Number(report.Vehicle));
        continue;
      }
      if (mapped.latitude < 43 || mapped.latitude > 46 || mapped.longitude < -95.5 || mapped.longitude > -92) {
        await safeDiagnostic(pool, "shared_avl_ingestion", "out_of_bounds", "Avail AVL report coordinates were outside the MVTA operating bounds.", mapped.vehicle_id);
      }

      try {
        const current = (await pool.request().input("vehicle_id", sql.Int, mapped.vehicle_id).query<{ report_timestamp: Date }>(
          "SELECT report_timestamp FROM AvailAvlVehiclePositions WHERE vehicle_id=@vehicle_id",
        )).recordset[0];
        if (!shouldAcceptObservation(current, mapped)) continue;
        const request = pool.request();
        request.input("vehicle_id", sql.Int, mapped.vehicle_id);
        request.input("route", sql.Int, mapped.route);
        request.input("block", sql.Int, mapped.block);
        request.input("run", sql.Int, mapped.run);
        request.input("trip", sql.Int, mapped.trip);
        request.input("latitude", sql.Float, mapped.latitude);
        request.input("longitude", sql.Float, mapped.longitude);
        request.input("heading", sql.Float, mapped.heading);
        request.input("direction", sql.NVarChar, mapped.direction);
        request.input("report_timestamp", sql.DateTime2, mapped.report_timestamp);
        await request.query(`
          MERGE AvailAvlVehiclePositions WITH (HOLDLOCK) AS target
          USING (SELECT @vehicle_id AS vehicle_id) AS src
          ON target.vehicle_id = src.vehicle_id
          WHEN MATCHED THEN
            UPDATE SET
              route = @route, block = @block, run = @run, trip = @trip,
              latitude = @latitude, longitude = @longitude, heading = @heading,
              direction = @direction, report_timestamp = @report_timestamp,
              updated_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (vehicle_id, route, block, run, trip, latitude, longitude, heading, direction, report_timestamp)
            VALUES (@vehicle_id, @route, @block, @run, @trip, @latitude, @longitude, @heading, @direction, @report_timestamp);
        `);
        upsertedCount++;
      } catch (err) {
        context.error(`Failed to upsert Avail AVL position for vehicle ${mapped.vehicle_id}:`, err);
      }

    }

    // Current-position tables are operational state, not history. Removing
    // stale rows prevents buses that signed off (or left event service) from
    // lingering indefinitely in the monitoring list and map.
    await pool.request().query(`
      DELETE FROM AvailAvlVehiclePositions
      WHERE report_timestamp < DATEADD(MINUTE, -3, SYSUTCDATETIME());

      IF OBJECT_ID('dbo.EventVehicleCurrentPosition', 'U') IS NOT NULL
      DELETE FROM EventVehicleCurrentPosition
      WHERE report_timestamp < DATEADD(MINUTE, -15, SYSUTCDATETIME());
    `);
    if (eventDue && tableCheck.recordset[0]?.table_exists === 1) {
      try {
        await projectEventPositions(pool);
        await safeHealth(pool, "event_projection", "healthy", "Event projection completed.");
      } catch (err) {
        context.error("Event position projection skipped:", err);
        await safeHealth(pool, "event_projection", "failed", "Event projection failed.", err);
      }
      try {
        await detectEventGeofenceCrossings(context);
        await safeHealth(pool, "crossing_detection", "healthy", "Crossing detection completed.");
      } catch (err) {
        context.error("Event geofence detection skipped:", err);
        await safeHealth(pool, "crossing_detection", "failed", "Crossing detection failed.", err);
      }
      try {
        await detectMonitoringAreaTests(context);
      } catch (err) {
        context.error("Depot departure test detection skipped:", err);
      }
    }

    context.log(
      `Avail AVL Reports poll: ${reports.length} reports seen, ${upsertedCount} vehicles upserted, ` +
      `${eventDue ? "event projection due" : "event projection deferred"}.`,
    );
  },
});
