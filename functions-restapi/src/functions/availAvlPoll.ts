// Timer-triggered ingestion of Avail's proprietary AVL Reports API - a
// separate vehicle-location source from the GTFS-Realtime VehiclePosition
// feed (gtfsVehiclePositionsPoll.ts). Purely monitoring data, same as that
// poller: no alerting concept, nothing here ever escalates into
// SuggestedAlerts. Upserts one row per vehicle (its latest known position)
// into AvailAvlVehiclePositions, keyed by Avail's own vehicle_id.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchAvlReports, mapAvlReport } from "../lib/availAvl";

app.timer("availAvlPoll", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const baseUrl = process.env.AVAIL_AVL_REPORTS_URL;
    const apiKey = process.env.AVAIL_AVL_REPORTS_API_KEY;
    if (!baseUrl || !apiKey) {
      context.warn("AVAIL_AVL_REPORTS_URL/AVAIL_AVL_REPORTS_API_KEY are not configured - skipping this run.");
      return;
    }

    let reports;
    try {
      reports = await fetchAvlReports(baseUrl, apiKey);
    } catch (err) {
      context.error("Failed to fetch Avail AVL Reports:", err);
      return;
    }

    const pool = await getPool();
    let upsertedCount = 0;

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
    }

    context.log(`Avail AVL Reports poll: ${reports.length} reports seen, ${upsertedCount} vehicles upserted.`);
  },
});
