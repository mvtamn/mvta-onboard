// Timer-triggered ingestion of Avail's proprietary AVL Reports API - a
// separate vehicle-location source from the GTFS-Realtime VehiclePosition
// feed (gtfsVehiclePositionsPoll.ts). Purely monitoring data, same as that
// poller: no alerting concept, nothing here ever escalates into
// SuggestedAlerts. Upserts one row per vehicle (its latest known position)
// into AvailAvlVehiclePositions, keyed by Avail's own vehicle_id.
//
// ALSO classifies each report against RouteClassification (migration-016)
// and, for SpecialEvent-classified routes only, writes an additional row
// into EventVehicleCurrentPosition/EventVehiclePositionHistory - see
// detour-and-event-module-implementation-plan.md (Part A2) for why this
// reuses the shared fetch rather than a second, separately-shaped poll.
// The timer wakes every 15 seconds and an Admin-managed setting controls
// the effective 15-300 second interval. Gracefully skipped (not an error) if
// migration-016 hasn't been applied yet - the all-vehicles table above is
// unaffected either way.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchAvlReports, mapAvlReport } from "../lib/availAvl";

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
    if (settingsReady.recordset[0]?.ready === 1) {
      const lease = await pool.request().query<{ last_run_at: Date }>(`
        DECLARE @interval INT = COALESCE((
          SELECT TRY_CONVERT(INT, setting_value) FROM AppSettings
          WHERE module = 'event' AND setting_key = 'poll_interval_seconds'
        ), 30);
        SET @interval = CASE WHEN @interval < 15 THEN 15 WHEN @interval > 300 THEN 300 ELSE @interval END;

        UPDATE AppPollState WITH (UPDLOCK, HOLDLOCK)
        SET last_run_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.last_run_at
        WHERE module = 'event'
          AND (last_run_at IS NULL OR last_run_at <= DATEADD(SECOND, -@interval, SYSUTCDATETIME()));
      `);
      if (lease.recordset.length === 0) return;
    }

    // Keep a two-minute overlap so delayed reports are not lost while the
    // monitoring UI refreshes every 30 seconds.
    // This remains well under the feed's 24-hour maximum window.
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    let reports;
    try {
      reports = await fetchAvlReports(baseUrl, apiKey, twoMinutesAgo, now);
    } catch (err) {
      context.error("Failed to fetch Avail AVL Reports:", err);
      return;
    }

    const tableCheck = await pool.request().query<{ table_exists: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.RouteClassification', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
    `);
    let specialEventRouteIds = new Set<number>();
    if (tableCheck.recordset[0]?.table_exists === 1) {
      const classResult = await pool.request().query<{ route_id: number }>(`
        SELECT route_id FROM RouteClassification WHERE route_category = 'SpecialEvent' AND is_active = 1
      `);
      specialEventRouteIds = new Set(classResult.recordset.map((r) => r.route_id));
    }

    let upsertedCount = 0;
    let eventUpsertedCount = 0;

    for (const report of reports) {
      let mapped;
      try {
        mapped = mapAvlReport(report);
      } catch (err) {
        context.error(`Failed to map Avail AVL report for vehicle ${report.Vehicle}:`, err);
        continue;
      }
      if (!mapped) continue;

      try {
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

      if (mapped.route !== null && specialEventRouteIds.has(mapped.route)) {
        try {
          const eventRequest = pool.request();
          eventRequest.input("vehicle_id", sql.Int, mapped.vehicle_id);
          eventRequest.input("route", sql.Int, mapped.route);
          eventRequest.input("latitude", sql.Float, mapped.latitude);
          eventRequest.input("longitude", sql.Float, mapped.longitude);
          eventRequest.input("heading", sql.Float, mapped.heading);
          eventRequest.input("report_timestamp", sql.DateTime2, mapped.report_timestamp);
          await eventRequest.query(`
            MERGE EventVehicleCurrentPosition WITH (HOLDLOCK) AS target
            USING (SELECT @vehicle_id AS vehicle_id) AS src
            ON target.vehicle_id = src.vehicle_id
            WHEN MATCHED THEN
              UPDATE SET route = @route, latitude = @latitude, longitude = @longitude,
                heading = @heading, report_timestamp = @report_timestamp, updated_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
              INSERT (vehicle_id, route, latitude, longitude, heading, report_timestamp)
              VALUES (@vehicle_id, @route, @latitude, @longitude, @heading, @report_timestamp);

            INSERT INTO EventVehiclePositionHistory (vehicle_id, route, latitude, longitude, heading, report_timestamp)
            VALUES (@vehicle_id, @route, @latitude, @longitude, @heading, @report_timestamp);
          `);
          eventUpsertedCount++;
        } catch (err) {
          context.error(`Failed to upsert event-bus position for vehicle ${mapped.vehicle_id}:`, err);
        }
      }
    }

    // Current-position tables are operational state, not history. Removing
    // stale rows prevents buses that signed off (or left event service) from
    // lingering indefinitely in the monitoring list and map.
    await pool.request().query(`
      DELETE FROM AvailAvlVehiclePositions
      WHERE report_timestamp < DATEADD(MINUTE, -3, SYSUTCDATETIME());

      IF OBJECT_ID('dbo.EventVehicleCurrentPosition', 'U') IS NOT NULL
        DELETE p
        FROM EventVehicleCurrentPosition p
        LEFT JOIN RouteClassification rc
          ON rc.route_id = p.route
          AND rc.route_category = 'SpecialEvent'
          AND rc.is_active = 1
        WHERE p.report_timestamp < DATEADD(MINUTE, -3, SYSUTCDATETIME())
           OR rc.route_id IS NULL;
    `);

    context.log(
      `Avail AVL Reports poll: ${reports.length} reports seen, ${upsertedCount} vehicles upserted, ` +
        `${eventUpsertedCount} classified as special-event.`,
    );
  },
});
