// Timer-triggered missed-trip detection - two independent signals:
//
// 1. Explicit cancellation: the GTFS-RT TripUpdate feed already carries
//    Trip.schedule_relationship = CANCELED for a trip the agency's own
//    dispatch system explicitly pulled. Cheap - reuses the same feed fetch
//    gtfsDelaysPoll.ts already makes, no schedule data needed.
// 2. Silent no-show: a trip that was scheduled to run but never reported at
//    all, with nobody flagging it. This is the operationally important case -
//    detecting it requires knowing what SHOULD have run (GtfsCalendar +
//    GtfsCalendarDates + GtfsScheduledTrips, migration-011) cross-referenced
//    against what's actually been observed (GtfsObservedTrips, written by
//    gtfsDelaysPoll.ts).
//
// This is a compliance/investigation tool, not a customer-alert feed: a
// detected trip is only saved to MonitoredMissedTrips for staff to review and
// validate. Unlike every other detector in this codebase, it does NOT
// auto-insert into SuggestedAlerts - preparing a rider notice is a separate,
// explicit staff action taken after investigation (via the console module's
// own "Prepare rider alert" button, same prepare/focus flow as everywhere
// else), not an automatic side effect of detection.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchTripUpdateFeed, mapCanceledTrip, type CanceledTrip } from "../lib/gtfsTripUpdates";

const GRACE_MINUTES = 15; // matches the existing delay-threshold convention

async function alreadyTracked(pool: sql.ConnectionPool, tripId: string, serviceDate: string): Promise<boolean> {
  const req = pool.request();
  req.input("trip_id", sql.NVarChar, tripId);
  req.input("service_date", sql.NVarChar, serviceDate);
  const result = await req.query<{ trip_id: string }>(
    "SELECT trip_id FROM MonitoredMissedTrips WHERE trip_id = @trip_id AND service_date = @service_date",
  );
  return result.recordset.length > 0;
}

// A cancellation is a discrete, already-final signal - the agency's own
// dispatch system pulled the trip, so there's no "grace period" to wait out
// before flagging it. Best-effort look up the trip's scheduled start from the
// static schedule reference (if migration 011 has populated it) purely for
// display; fall back to "now" for both timestamps when it isn't available so
// the NOT NULL columns still have a sensible value.
async function scheduledStartFor(
  pool: sql.ConnectionPool,
  tripId: string,
  serviceDate: string,
): Promise<Date | null> {
  const scheduleTableCheck = await pool.request().query<{ ok: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.GtfsScheduledTrips', 'U') IS NULL THEN 0 ELSE 1 END AS ok
  `);
  if (scheduleTableCheck.recordset[0]?.ok !== 1) return null;

  const req = pool.request();
  req.input("trip_id", sql.NVarChar, tripId);
  const result = await req.query<{ first_departure_seconds: number }>(
    "SELECT TOP 1 first_departure_seconds FROM GtfsScheduledTrips WHERE trip_id = @trip_id",
  );
  const seconds = result.recordset[0]?.first_departure_seconds;
  if (seconds === undefined) return null;

  const year = Number(serviceDate.slice(0, 4));
  const month = Number(serviceDate.slice(4, 6)) - 1;
  const day = Number(serviceDate.slice(6, 8));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const scheduledAt = new Date(0);
  scheduledAt.setUTCFullYear(year, month, day);
  scheduledAt.setUTCSeconds(seconds);
  return scheduledAt;
}

async function flagCanceled(pool: sql.ConnectionPool, trip: CanceledTrip, context: InvocationContext): Promise<boolean> {
  const serviceDate = trip.service_date ?? "unknown";
  if (await alreadyTracked(pool, trip.trip_id, serviceDate)) return false;

  const now = new Date();
  const scheduledAt = (await scheduledStartFor(pool, trip.trip_id, serviceDate)) ?? now;

  const insertReq = pool.request();
  insertReq.input("trip_id", sql.NVarChar, trip.trip_id);
  insertReq.input("service_date", sql.NVarChar, serviceDate);
  insertReq.input("route_id", sql.NVarChar, trip.route_id);
  insertReq.input("scheduled_departure_at", sql.DateTime2, scheduledAt);
  insertReq.input("grace_deadline_at", sql.DateTime2, now);
  await insertReq.query(`
    INSERT INTO MonitoredMissedTrips (
      trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type
    )
    VALUES (@trip_id, @service_date, @route_id, @scheduled_departure_at, @grace_deadline_at, 'escalated', 'explicit_cancellation')
  `);
  context.log(`Missed trip flagged for review (canceled): trip ${trip.trip_id} (route ${trip.route_id}, service date ${serviceDate})`);
  return true;
}

function serviceDateToday(): string {
  // GTFS service_date convention: YYYYMMDD, local-agency-day. Using UTC date
  // here is a known simplification (MVTA operates in a single time zone and
  // this only needs day-level granularity for schedule lookups) - revisit if
  // trips near local midnight prove to matter.
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
}

function dowColumn(date: Date): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[date.getUTCDay()];
}

interface ScheduledTripRow {
  trip_id: string;
  route_id: string;
  first_departure_seconds: number;
}

async function activeServiceIdsToday(pool: sql.ConnectionPool, serviceDate: string, dow: string): Promise<string[]> {
  const req = pool.request();
  req.input("service_date", sql.Char(8), serviceDate);
  const result = await req.query<{ service_id: string }>(`
    SELECT c.service_id
    FROM GtfsCalendar c
    WHERE c.${dow} = 1
      AND @service_date BETWEEN c.start_date AND c.end_date
      AND NOT EXISTS (
        SELECT 1 FROM GtfsCalendarDates cd
        WHERE cd.service_id = c.service_id AND cd.service_date = @service_date AND cd.exception_type = 2
      )
    UNION
    SELECT cd.service_id
    FROM GtfsCalendarDates cd
    WHERE cd.service_date = @service_date AND cd.exception_type = 1
  `);
  return result.recordset.map((r) => r.service_id);
}

async function detectSilentNoShows(pool: sql.ConnectionPool, context: InvocationContext): Promise<number> {
  const scheduleTablesExist = await pool.request().query<{ ok: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.GtfsScheduledTrips', 'U') IS NULL THEN 0 ELSE 1 END AS ok
  `);
  if (scheduleTablesExist.recordset[0]?.ok !== 1) {
    context.warn("GtfsScheduledTrips does not exist yet - apply migration 011 before schedule-based detection can run.");
    return 0;
  }

  const now = new Date();
  const serviceDate = serviceDateToday();
  const dow = dowColumn(now);
  const secondsSinceMidnightUtc = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const graceSeconds = GRACE_MINUTES * 60;

  const serviceIds = await activeServiceIdsToday(pool, serviceDate, dow);
  if (serviceIds.length === 0) return 0;

  const req = pool.request();
  req.input("service_date", sql.NVarChar, serviceDate);
  req.input("cutoff_seconds", sql.Int, secondsSinceMidnightUtc - graceSeconds);
  const serviceIdParams = serviceIds.map((_, i) => `@sid${i}`).join(", ");
  serviceIds.forEach((id, i) => req.input(`sid${i}`, sql.NVarChar, id));

  // Trips scheduled today, whose grace deadline has passed, that have never
  // been observed in the realtime feed and aren't already tracked.
  const dueTrips = await req.query<ScheduledTripRow>(`
    SELECT st.trip_id, st.route_id, st.first_departure_seconds
    FROM GtfsScheduledTrips st
    WHERE st.service_id IN (${serviceIdParams})
      AND st.first_departure_seconds <= @cutoff_seconds
      AND NOT EXISTS (
        SELECT 1 FROM GtfsObservedTrips ot
        WHERE ot.trip_id = st.trip_id AND ot.service_date = @service_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM MonitoredMissedTrips mmt
        WHERE mmt.trip_id = st.trip_id AND mmt.service_date = @service_date
      )
  `);

  let flaggedCount = 0;
  for (const trip of dueTrips.recordset) {
    const scheduledAt = new Date(0);
    scheduledAt.setUTCFullYear(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    scheduledAt.setUTCSeconds(trip.first_departure_seconds);
    const graceDeadline = new Date(scheduledAt.getTime() + graceSeconds * 1000);

    try {
      const trackReq = pool.request();
      trackReq.input("trip_id", sql.NVarChar, trip.trip_id);
      trackReq.input("service_date", sql.NVarChar, serviceDate);
      trackReq.input("route_id", sql.NVarChar, trip.route_id);
      trackReq.input("scheduled_departure_at", sql.DateTime2, scheduledAt);
      trackReq.input("grace_deadline_at", sql.DateTime2, graceDeadline);
      await trackReq.query(`
        INSERT INTO MonitoredMissedTrips (
          trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type
        )
        VALUES (@trip_id, @service_date, @route_id, @scheduled_departure_at, @grace_deadline_at, 'escalated', 'silent_no_show')
      `);
      flaggedCount++;
      context.log(`Missed trip flagged for review (no-show): trip ${trip.trip_id} (route ${trip.route_id}, scheduled ${scheduledAt.toISOString()})`);
    } catch (err) {
      context.error(`Failed to flag no-show for trip ${trip.trip_id}:`, err);
    }
  }
  return flaggedCount;
}

async function resolveLateArrivals(pool: sql.ConnectionPool, context: InvocationContext): Promise<void> {
  try {
    await pool.request().query(`
      UPDATE mmt
      SET status = 'resolved', detected_late_arrival_at = ot.first_observed_at, last_checked_at = SYSUTCDATETIME()
      FROM MonitoredMissedTrips mmt
      INNER JOIN GtfsObservedTrips ot
        ON ot.trip_id = mmt.trip_id AND ot.service_date = mmt.service_date
      WHERE mmt.status IN ('watching', 'escalated')
    `);
  } catch (err) {
    context.error("Failed to resolve late-arriving missed trips:", err);
  }
}

app.timer("gtfsMissedTripsPoll", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.GTFS_RT_TRIPUPDATE_URL;
    if (!feedUrl) {
      context.warn("GTFS_RT_TRIPUPDATE_URL is not configured - skipping this run.");
      return;
    }

    let feed;
    try {
      feed = await fetchTripUpdateFeed(feedUrl);
    } catch (err) {
      context.error("Failed to fetch GTFS-RT TripUpdate feed:", err);
      return;
    }

    const pool = await getPool();
    let canceledCount = 0;

    for (const entity of feed.Entities) {
      const canceled = mapCanceledTrip(entity);
      if (!canceled) continue;
      try {
        if (await flagCanceled(pool, canceled, context)) canceledCount++;
      } catch (err) {
        context.error(`Failed to process canceled trip ${canceled.trip_id}:`, err);
      }
    }

    let noShowCount = 0;
    try {
      noShowCount = await detectSilentNoShows(pool, context);
    } catch (err) {
      context.error("Failed to run silent no-show detection:", err);
    }

    await resolveLateArrivals(pool, context);

    context.log(
      `Missed-trip poll: ${feed.Entities.length} entities seen, ${canceledCount} cancellations flagged, ${noShowCount} silent no-shows flagged.`,
    );
  },
});
