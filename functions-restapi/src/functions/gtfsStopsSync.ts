// Daily sync of MVTA's static GTFS schedule into GtfsStops (human-readable
// stop names), GtfsRoutes (the authoritative route registry), and
// GtfsTripDirections (route direction labels - NB/SB/EB/WB
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

    let stops, trips, routes;
    try {
      ({ stops, trips, routes } = await fetchAndParseStatic(feedUrl));
    } catch (err) {
      context.error("Failed to fetch/parse the static GTFS feed:", err);
      return;
    }
    if (stops.length === 0 && trips.length === 0 && routes.length === 0) {
      context.warn(
        "Static GTFS feed parsed to zero stops/trips/routes - keeping the existing data.",
      );
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

      const routeTableCheck = await new sql.Request(tx).query<{
        table_exists: number;
      }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.GtfsRoutes', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      const routeTableExists =
        routeTableCheck.recordset[0]?.table_exists === 1;
      if (routeTableExists) {
        await new sql.Request(tx).query("TRUNCATE TABLE GtfsRoutes");
        for (const route of routes) {
          const insertReq = new sql.Request(tx);
          insertReq.input("route_id", sql.NVarChar, route.route_id);
          insertReq.input("agency_id", sql.NVarChar, route.agency_id);
          insertReq.input(
            "route_short_name",
            sql.NVarChar,
            route.route_short_name,
          );
          insertReq.input(
            "route_long_name",
            sql.NVarChar,
            route.route_long_name,
          );
          insertReq.input("route_desc", sql.NVarChar, route.route_desc);
          insertReq.input("route_type", sql.Int, route.route_type);
          insertReq.input("route_url", sql.NVarChar, route.route_url);
          insertReq.input("route_color", sql.NVarChar, route.route_color);
          insertReq.input(
            "route_text_color",
            sql.NVarChar,
            route.route_text_color,
          );
          insertReq.input(
            "route_sort_order",
            sql.Int,
            route.route_sort_order,
          );
          await insertReq.query(`
            INSERT INTO GtfsRoutes (
              route_id, agency_id, route_short_name, route_long_name,
              route_desc, route_type, route_url, route_color,
              route_text_color, route_sort_order
            )
            VALUES (
              @route_id, @agency_id, @route_short_name, @route_long_name,
              @route_desc, @route_type, @route_url, @route_color,
              @route_text_color, @route_sort_order
            )
          `);
        }
      }

      await tx.commit();
      context.log(
        `GTFS static sync: refreshed ${stops.length} stops, ` +
          `${resolvedTrips.length} trip directions, and ` +
          `${routeTableExists ? routes.length : 0} routes.`,
      );
      if (!routeTableExists) {
        context.warn(
          "GtfsRoutes does not exist yet; apply migration 010 before the next static sync.",
        );
      }
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error(
        "Failed to refresh GtfsStops/GtfsTripDirections/GtfsRoutes:",
        err,
      );
    }
  },
});
