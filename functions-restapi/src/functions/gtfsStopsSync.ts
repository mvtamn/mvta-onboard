// Daily sync of MVTA's static GTFS schedule into GtfsStops (human-readable
// stop names, used by gtfsDelaysPoll.ts to build readable rider-facing
// delay text) and GtfsTripDirections (route direction labels - NB/SB/EB/WB
// - used by the Live Delays console view; neither realtime feed has a
// direction field at all, so this is the only source for it). Static
// schedules change infrequently, so this does a full replace rather than an
// incremental diff.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchAndParseStatic, resolveDirectionLabels } from "../lib/gtfsStatic";

app.timer("gtfsStopsSync", {
  schedule: "0 0 9 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.GTFS_STATIC_URL;
    if (!feedUrl) {
      context.warn("GTFS_STATIC_URL is not configured - skipping this run.");
      return;
    }

    let stops, trips;
    try {
      ({ stops, trips } = await fetchAndParseStatic(feedUrl));
    } catch (err) {
      context.error("Failed to fetch/parse the static GTFS feed:", err);
      return;
    }
    if (stops.length === 0 && trips.length === 0) {
      context.warn("Static GTFS feed parsed to zero stops/trips - keeping the existing data.");
      return;
    }

    const resolvedTrips = resolveDirectionLabels(trips);

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      const clearStopsReq = new sql.Request(tx);
      await clearStopsReq.query("TRUNCATE TABLE GtfsStops");
      for (const stop of stops) {
        const insertReq = new sql.Request(tx);
        insertReq.input("stop_id", sql.NVarChar, stop.stop_id);
        insertReq.input("stop_name", sql.NVarChar, stop.stop_name);
        insertReq.input("stop_lat", sql.Float, stop.stop_lat);
        insertReq.input("stop_lon", sql.Float, stop.stop_lon);
        await insertReq.query(`
          INSERT INTO GtfsStops (stop_id, stop_name, stop_lat, stop_lon)
          VALUES (@stop_id, @stop_name, @stop_lat, @stop_lon)
        `);
      }

      const clearTripsReq = new sql.Request(tx);
      await clearTripsReq.query("TRUNCATE TABLE GtfsTripDirections");
      for (const trip of resolvedTrips) {
        const insertReq = new sql.Request(tx);
        insertReq.input("trip_id", sql.NVarChar, trip.trip_id);
        insertReq.input("route_id", sql.NVarChar, trip.route_id);
        insertReq.input("direction_id", sql.Int, trip.direction_id);
        insertReq.input("trip_headsign", sql.NVarChar, trip.trip_headsign);
        insertReq.input("direction_label", sql.NVarChar, trip.direction_label);
        await insertReq.query(`
          INSERT INTO GtfsTripDirections (trip_id, route_id, direction_id, trip_headsign, direction_label)
          VALUES (@trip_id, @route_id, @direction_id, @trip_headsign, @direction_label)
        `);
      }

      await tx.commit();
      context.log(`GTFS static sync: refreshed ${stops.length} stops, ${resolvedTrips.length} trip directions.`);
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error("Failed to refresh GtfsStops/GtfsTripDirections:", err);
    }
  },
});
