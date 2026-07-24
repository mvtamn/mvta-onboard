// Timer-triggered ingestion of MVTA's GTFS-Realtime VehiclePosition feed.
//
// Purely monitoring data (live GPS, speed, occupancy, stop status) - no
// alerting concept, nothing here ever escalates into SuggestedAlerts.
// Updates the same MonitoredTripDelays row gtfsDelaysPoll.ts maintains
// (matched by trip_id, since both feeds cover the identical set of active
// trips), but only UPDATEs its own position/occupancy columns - never
// inserts. If a position reading arrives before TripUpdate has created the
// row for that trip, it's skipped: inserting here would need a placeholder
// delay_seconds that could misleadingly look like a verified on-time
// reading.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchVehiclePositionFeed, mapVehiclePositionEntity } from "../lib/gtfsVehiclePositions";

app.timer("gtfsVehiclePositionsPoll", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.GTFS_RT_VEHICLE_URL;
    if (!feedUrl) {
      context.warn("GTFS_RT_VEHICLE_URL is not configured - skipping this run.");
      return;
    }

    let feed;
    try {
      feed = await fetchVehiclePositionFeed(feedUrl);
    } catch (err) {
      context.error("Failed to fetch GTFS-RT VehiclePosition feed:", err);
      return;
    }

    const pool = await getPool();
    let updatedCount = 0;

    for (const entity of feed.Entities) {
      let mapped;
      try {
        mapped = mapVehiclePositionEntity(entity);
      } catch (err) {
        context.error(`Failed to map GTFS-RT vehicle position entity ${entity.Id}:`, err);
        continue;
      }
      if (!mapped) continue;

      try {
        const request = pool.request();
        request.input("trip_id", sql.NVarChar, mapped.trip_id);
        request.input("latitude", sql.Float, mapped.latitude);
        request.input("longitude", sql.Float, mapped.longitude);
        request.input("bearing", sql.Float, mapped.bearing);
        request.input("speed_mps", sql.Float, mapped.speed_mps);
        request.input("occupancy_status", sql.Int, mapped.occupancy_status);
        request.input("current_status", sql.Int, mapped.current_status);
        const result = await request.query(`
          UPDATE MonitoredTripDelays
          SET latitude = @latitude,
              longitude = @longitude,
              bearing = @bearing,
              speed_mps = @speed_mps,
              occupancy_status = @occupancy_status,
              current_status = @current_status,
              position_updated_at = SYSUTCDATETIME()
          WHERE trip_id = @trip_id
        `);
        if (result.rowsAffected[0] > 0) updatedCount++;
      } catch (err) {
        context.error(`Failed to update position for trip ${mapped.trip_id}:`, err);
      }
    }

    context.log(
      `GTFS-RT VehiclePosition poll: ${feed.Entities.length} entities seen, ${updatedCount} trips updated.`,
    );
  },
});
