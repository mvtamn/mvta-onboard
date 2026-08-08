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
// reuses the existing 5-minute fetch rather than a second, separately-
// shaped poll against the same feed. Gracefully skipped (not an error) if
// migration-016 hasn't been applied yet - the all-vehicles table above is
// unaffected either way.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchAvlReports, mapAvlReport } from "../lib/availAvl";

app.timer("availAvlPoll", {
  schedule: "*/30 * * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const baseUrl = process.env.AVAIL_AVL_REPORTS_URL;
    const apiKey = process.env.AVAIL_AVL_REPORTS_API_KEY;
    if (!baseUrl || !apiKey) {
      context.warn("AVAIL_AVL_REPORTS_URL/AVAIL_AVL_REPORTS_API_KEY are not configured - skipping this run.");
      return;
    }

    // Keep a two-minute overlap so delayed reports are not lost while the
    // monitoring UI and this ingestion job both refresh every 30 seconds.
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

    const pool = await getPool();

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
