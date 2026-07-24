// Daily sync of MVTA's static GTFS schedule into GtfsStops - the sole source
// of human-readable stop names used by gtfsDelaysPoll.ts to build readable
// rider-facing delay text. Static schedules change infrequently, so this
// does a full replace rather than an incremental diff.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchAndParseStops } from "../lib/gtfsStatic";

app.timer("gtfsStopsSync", {
  schedule: "0 0 9 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.GTFS_STATIC_URL;
    if (!feedUrl) {
      context.warn("GTFS_STATIC_URL is not configured - skipping this run.");
      return;
    }

    let stops;
    try {
      stops = await fetchAndParseStops(feedUrl);
    } catch (err) {
      context.error("Failed to fetch/parse the static GTFS feed:", err);
      return;
    }
    if (stops.length === 0) {
      context.warn("Static GTFS feed parsed to zero stops - keeping the existing GtfsStops data.");
      return;
    }

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const clearReq = new sql.Request(tx);
      await clearReq.query("TRUNCATE TABLE GtfsStops");

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
      await tx.commit();
      context.log(`GTFS static sync: refreshed ${stops.length} stops.`);
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error("Failed to refresh GtfsStops:", err);
    }
  },
});
