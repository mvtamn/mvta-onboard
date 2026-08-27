// Daily sync of MVTA's static GTFS schedule into GtfsStops (human-readable
// stop names), GtfsRoutes (the authoritative route registry),
// GtfsTripDirections (route direction labels - NB/SB/EB/WB
// - used by the Live Delays console view; neither realtime feed has a
// direction field at all, so this is the only source for it), and (once
// migration 011 has been applied) GtfsCalendar/GtfsCalendarDates/
// GtfsScheduledTrips - the schedule reference the missed-trip silent-no-show
// detector (gtfsMissedTripsPoll.ts) needs to know what SHOULD have run.
// Static schedules change infrequently, so this does a full replace rather
// than an incremental diff.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchAndParseStatic, resolveDirectionLabels } from "../lib/gtfsStatic";
import { recordFeedHealth } from "../lib/missedTripFeedHealth";

app.timer("gtfsStopsSync", {
  schedule: "0 0 9 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.GTFS_STATIC_URL;
    if (!feedUrl) {
      context.warn("GTFS_STATIC_URL is not configured - skipping this run.");
      return;
    }

    let stops, trips, routes, scheduledTrips, calendar, calendarDates;
    try {
      ({ stops, trips, routes, scheduledTrips, calendar, calendarDates } =
        await fetchAndParseStatic(feedUrl));
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

      const scheduleTableCheck = await new sql.Request(tx).query<{
        table_exists: number;
      }>(`
        SELECT CASE
          WHEN OBJECT_ID('dbo.GtfsCalendar', 'U') IS NOT NULL
           AND OBJECT_ID('dbo.GtfsCalendarDates', 'U') IS NOT NULL
           AND OBJECT_ID('dbo.GtfsScheduledTrips', 'U') IS NOT NULL
           AND COL_LENGTH('dbo.GtfsScheduledTrips', 'first_stop_id') IS NOT NULL
           AND COL_LENGTH('dbo.GtfsScheduledTrips', 'first_stop_sequence') IS NOT NULL
           AND COL_LENGTH('dbo.GtfsScheduledTrips', 'block_id') IS NOT NULL
          THEN 1 ELSE 0 END AS table_exists
      `);
      const scheduleTablesExist = scheduleTableCheck.recordset[0]?.table_exists === 1;
      let scheduledTripCount = 0;
      if (scheduleTablesExist) {
        const scheduleByTrip = new Map(scheduledTrips.map((t) => [t.trip_id, t]));

        await new sql.Request(tx).query("TRUNCATE TABLE GtfsCalendar");
        for (const cal of calendar) {
          const insertReq = new sql.Request(tx);
          insertReq.input("service_id", sql.NVarChar, cal.service_id);
          insertReq.input("monday", sql.Bit, cal.monday);
          insertReq.input("tuesday", sql.Bit, cal.tuesday);
          insertReq.input("wednesday", sql.Bit, cal.wednesday);
          insertReq.input("thursday", sql.Bit, cal.thursday);
          insertReq.input("friday", sql.Bit, cal.friday);
          insertReq.input("saturday", sql.Bit, cal.saturday);
          insertReq.input("sunday", sql.Bit, cal.sunday);
          insertReq.input("start_date", sql.Char(8), cal.start_date);
          insertReq.input("end_date", sql.Char(8), cal.end_date);
          await insertReq.query(`
            INSERT INTO GtfsCalendar (
              service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday,
              start_date, end_date
            )
            VALUES (
              @service_id, @monday, @tuesday, @wednesday, @thursday, @friday, @saturday, @sunday,
              @start_date, @end_date
            )
          `);
        }

        await new sql.Request(tx).query("TRUNCATE TABLE GtfsCalendarDates");
        for (const cd of calendarDates) {
          const insertReq = new sql.Request(tx);
          insertReq.input("service_id", sql.NVarChar, cd.service_id);
          insertReq.input("service_date", sql.Char(8), cd.service_date);
          insertReq.input("exception_type", sql.Int, cd.exception_type);
          await insertReq.query(`
            INSERT INTO GtfsCalendarDates (service_id, service_date, exception_type)
            VALUES (@service_id, @service_date, @exception_type)
          `);
        }

        await new sql.Request(tx).query("TRUNCATE TABLE GtfsScheduledTrips");
        for (const trip of trips) {
          const schedule = scheduleByTrip.get(trip.trip_id);
          if (!schedule || !trip.service_id) continue;
          const insertReq = new sql.Request(tx);
          insertReq.input("trip_id", sql.NVarChar, trip.trip_id);
          insertReq.input("route_id", sql.NVarChar, trip.route_id);
          insertReq.input("service_id", sql.NVarChar, trip.service_id);
          insertReq.input("first_departure_seconds", sql.Int, schedule.first_departure_seconds);
          insertReq.input("first_stop_id", sql.NVarChar, schedule.first_stop_id);
          insertReq.input("first_stop_sequence", sql.Int, schedule.first_stop_sequence);
          insertReq.input("block_id", sql.NVarChar, trip.block_id);
          await insertReq.query(`
            INSERT INTO GtfsScheduledTrips (
              trip_id, route_id, service_id, first_departure_seconds,
              first_stop_id, first_stop_sequence, block_id
            )
            VALUES (
              @trip_id, @route_id, @service_id, @first_departure_seconds,
              @first_stop_id, @first_stop_sequence, @block_id
            )
          `);
          scheduledTripCount++;
        }
      }

      await tx.commit();
      try {
        await recordFeedHealth(pool, "gtfs_static", stops.length + trips.length + routes.length, null, { startAt: new Date(), endAt: new Date() });
      } catch (healthError) {
        context.error("Failed to update static GTFS feed health:", healthError);
      }
      context.log(
        `GTFS static sync: refreshed ${stops.length} stops, ` +
          `${resolvedTrips.length} trip directions, ` +
          `${routeTableExists ? routes.length : 0} routes, and ` +
          `${scheduleTablesExist ? scheduledTripCount : 0} scheduled trips.`,
      );
      if (!routeTableExists) {
        context.warn(
          "GtfsRoutes does not exist yet; apply migration 010 before the next static sync.",
        );
      }
      if (!scheduleTablesExist) {
        context.warn(
          "The complete GTFS schedule schema is not available; apply migration 027 before the next static sync.",
        );
      }
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error(
        "Failed to refresh GtfsStops/GtfsTripDirections/GtfsRoutes/GtfsScheduledTrips:",
        err,
      );
    }
  },
});
