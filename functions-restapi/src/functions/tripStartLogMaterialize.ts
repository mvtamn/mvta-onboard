// Nightly materialization of the Dispatch Log (plans/dispatch-log-spec.md
// §4.2): one TripStartLog row per revenue trip scheduled on a service date,
// for today and tomorrow, so the day's log exists before its first pullout.
//
// Scheduled in UTC on purpose. gtfsStopsSync replaces the schedule tables at
// 09:00 UTC; a "03:00 local" slot lands at 08:00 UTC through the eight months
// of daylight time and would build the day from yesterday's schedule, which
// the sync then truncates out from under it. 09:30 UTC is 04:30 CDT / 03:30
// CST - after the sync, before most of the day's service.
//
// What the row carries is a snapshot. Route name, origin stop name and the
// resolved start instant are copied in because GtfsScheduledTrips is a full
// replace every morning: once a service change lands, a past day can no
// longer be reconstructed from it. in_rotation is likewise written once and
// kept - re-running a day that already exists refreshes the schedule fields
// (a republished trip may move) but never re-deals a day already in progress.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { activeServiceIdsToday, serviceDateIsCovered } from "../lib/gtfsScheduleHorizon";
import type { GtfsCalendarDateRow, GtfsCalendarRow } from "../lib/gtfsStatic";
import { agencyServiceDate, serviceDateAndGtfsSecondsToUtc } from "../lib/missedTripTime";
import {
  computeRotation,
  inRotation,
  isValidServiceDate,
  rotationDayFor,
  type Rotation,
  type RotationTrip,
} from "../lib/tripStartRotation";

export const TRIP_START_LOG_SETTINGS_MODULE = "trip_start_log";
export const ROTATION_ANCHOR_SETTING_KEY = "rotation_anchor_date";
const ACTOR = "tripStartLogMaterialize";

interface ScheduledRevenueTripRow {
  trip_id: string;
  route_id: string;
  service_id: string;
  block_id: string | null;
  first_departure_seconds: number;
  first_stop_id: string | null;
  route_short_name: string | null;
  direction_id: number | null;
  direction_label: string | null;
  origin_stop_name: string | null;
}

export interface MaterializeResult {
  service_date: string;
  outcome: "written" | "no_service" | "no_anchor" | "schema_missing";
  inserted: number;
  refreshed: number;
  rotation_count: number;
  week_offset: number | null;
}

// Where the anchor comes from when nobody has set it: the earliest day the
// imported schedule knows about. MVTA's feed publishes service through
// calendar_dates.txt alone, so the calendar_dates fallback is the path that
// actually runs there. This is a one-time seed, logged loudly; the setting is
// the source of truth from then on.
export function anchorFromSchedule(
  calendar: readonly GtfsCalendarRow[],
  calendarDates: readonly GtfsCalendarDateRow[],
): string | null {
  const candidates = [
    ...calendar.map((c) => c.start_date),
    ...calendarDates.filter((cd) => cd.exception_type === 1).map((cd) => cd.service_date),
  ].filter((d) => isValidServiceDate(d));
  if (candidates.length === 0) return null;
  return candidates.reduce((min, d) => (d < min ? d : min));
}

async function loadCalendar(pool: sql.ConnectionPool): Promise<{
  calendar: GtfsCalendarRow[];
  calendarDates: GtfsCalendarDateRow[];
}> {
  const calendar = await pool.request().query<GtfsCalendarRow>(`
    SELECT service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date
    FROM GtfsCalendar
  `);
  const calendarDates = await pool.request().query<GtfsCalendarDateRow>(`
    SELECT service_id, service_date, exception_type FROM GtfsCalendarDates
  `);
  return {
    calendar: calendar.recordset.map((c) => ({
      ...c,
      monday: Boolean(c.monday), tuesday: Boolean(c.tuesday), wednesday: Boolean(c.wednesday),
      thursday: Boolean(c.thursday), friday: Boolean(c.friday), saturday: Boolean(c.saturday),
      sunday: Boolean(c.sunday),
    })),
    calendarDates: calendarDates.recordset.map((cd) => ({
      ...cd,
      exception_type: Number(cd.exception_type) === 2 ? 2 : 1,
    })),
  };
}

export async function readRotationAnchor(pool: sql.ConnectionPool): Promise<string | null> {
  const req = pool.request();
  req.input("module", sql.NVarChar, TRIP_START_LOG_SETTINGS_MODULE);
  req.input("key", sql.NVarChar, ROTATION_ANCHOR_SETTING_KEY);
  const result = await req.query<{ setting_value: string }>(`
    SELECT setting_value FROM AppSettings WHERE module = @module AND setting_key = @key
  `);
  const value = result.recordset[0]?.setting_value?.trim() ?? "";
  return isValidServiceDate(value) ? value : null;
}

async function resolveRotationAnchor(
  pool: sql.ConnectionPool,
  context: InvocationContext,
  calendar: readonly GtfsCalendarRow[],
  calendarDates: readonly GtfsCalendarDateRow[],
): Promise<string | null> {
  const stored = await readRotationAnchor(pool);
  if (stored) return stored;
  const seeded = anchorFromSchedule(calendar, calendarDates);
  if (!seeded) return null;
  const req = pool.request();
  req.input("module", sql.NVarChar, TRIP_START_LOG_SETTINGS_MODULE);
  req.input("key", sql.NVarChar, ROTATION_ANCHOR_SETTING_KEY);
  req.input("value", sql.NVarChar, seeded);
  req.input("actor", sql.NVarChar, ACTOR);
  await req.query(`
    UPDATE AppSettings SET setting_value = @value, updated_by = @actor, updated_at = SYSUTCDATETIME()
    WHERE module = @module AND setting_key = @key AND LTRIM(RTRIM(setting_value)) = ''
  `);
  context.warn(
    `Trip-start log rotation anchor was unset; seeded it to ${seeded} from the imported schedule's earliest date. ` +
      `Confirm it matches the service change start (AppSettings ${TRIP_START_LOG_SETTINGS_MODULE}/${ROTATION_ANCHOR_SETTING_KEY}).`,
  );
  return seeded;
}

async function schemaReady(pool: sql.ConnectionPool): Promise<boolean> {
  const result = await pool.request().query<{ ok: number }>(`
    SELECT CASE
      WHEN OBJECT_ID('dbo.TripStartLog', 'U') IS NOT NULL
       AND OBJECT_ID('dbo.GtfsCalendar', 'U') IS NOT NULL
       AND OBJECT_ID('dbo.GtfsCalendarDates', 'U') IS NOT NULL
       AND OBJECT_ID('dbo.GtfsScheduledTrips', 'U') IS NOT NULL
       AND COL_LENGTH('dbo.GtfsScheduledTrips', 'block_id') IS NOT NULL
      THEN 1 ELSE 0 END AS ok
  `);
  return result.recordset[0]?.ok === 1;
}

// Every scheduled trip, for the rotation pools - membership is decided per
// week, not per date, so this must see trips that do not run on the target
// date (spec §4.1).
async function loadRotationTrips(pool: sql.ConnectionPool): Promise<RotationTrip[]> {
  const result = await pool.request().query<RotationTrip>(`
    SELECT trip_id, service_id, first_departure_seconds FROM GtfsScheduledTrips
  `);
  return result.recordset;
}

// The revenue trips that run on the date, with the display fields the log
// snapshots. Excludes routes actively classified SpecialEvent on the date -
// the same rule as the silent-no-show detector, for the same reason: a
// base-schedule trip on an overridden route is not a trip anyone intends to
// run that day, and listing it would ask the desk to verify a phantom.
async function loadRevenueTrips(
  pool: sql.ConnectionPool,
  serviceDate: string,
  serviceIds: readonly string[],
): Promise<ScheduledRevenueTripRow[]> {
  const req = pool.request();
  req.input("service_date", sql.Char(8), serviceDate);
  const serviceIdParams = serviceIds.map((_, i) => `@sid${i}`).join(", ");
  serviceIds.forEach((id, i) => req.input(`sid${i}`, sql.NVarChar, id));
  const result = await req.query<ScheduledRevenueTripRow>(`
    SELECT st.trip_id, st.route_id, st.service_id, st.block_id, st.first_departure_seconds, st.first_stop_id,
           r.route_short_name, d.direction_id, d.direction_label, s.stop_name AS origin_stop_name
    FROM GtfsScheduledTrips st
    LEFT JOIN GtfsRoutes r ON r.route_id = st.route_id
    LEFT JOIN GtfsTripDirections d ON d.trip_id = st.trip_id
    LEFT JOIN GtfsStops s ON s.stop_id = st.first_stop_id
    WHERE st.service_id IN (${serviceIdParams})
      AND NOT EXISTS (
        SELECT 1 FROM RouteClassification rc
        WHERE CAST(rc.route_id AS NVARCHAR(50)) = st.route_id
          AND rc.route_category = 'SpecialEvent'
          AND rc.is_active = 1
          AND (rc.effective_start_date IS NULL OR rc.effective_start_date <= @service_date)
          AND (rc.effective_end_date IS NULL OR rc.effective_end_date >= @service_date)
      )
  `);
  return result.recordset;
}

async function upsertTrip(
  tx: sql.Transaction,
  serviceDate: string,
  dow: string,
  trip: ScheduledRevenueTripRow,
  rotation: Rotation,
): Promise<"inserted" | "refreshed" | "skipped"> {
  const scheduledStartAt = serviceDateAndGtfsSecondsToUtc(serviceDate, trip.first_departure_seconds);
  if (!scheduledStartAt) return "skipped";
  const req = new sql.Request(tx);
  req.input("service_date", sql.Char(8), serviceDate);
  req.input("trip_id", sql.NVarChar, trip.trip_id);
  req.input("block_id", sql.NVarChar, trip.block_id);
  req.input("route_id", sql.NVarChar, trip.route_id);
  req.input("route_short_name", sql.NVarChar, trip.route_short_name);
  req.input("direction_id", sql.Int, trip.direction_id);
  req.input("direction_label", sql.NVarChar, trip.direction_label);
  req.input("origin_stop_id", sql.NVarChar, trip.first_stop_id);
  req.input("origin_stop_name", sql.NVarChar, trip.origin_stop_name);
  req.input("scheduled_start_seconds", sql.Int, trip.first_departure_seconds);
  req.input("scheduled_start_at", sql.DateTime2, scheduledStartAt);
  req.input("in_rotation", sql.Bit, inRotation(rotation, trip.trip_id, dow) ? 1 : 0);
  req.input("rotation_day", sql.NVarChar, rotationDayFor(rotation, trip.trip_id, dow));
  const result = await req.query<{ action: string }>(`
    MERGE TripStartLog WITH (HOLDLOCK) AS target
    USING (SELECT @service_date AS service_date, @trip_id AS trip_id) AS src
      ON target.service_date = src.service_date AND target.trip_id = src.trip_id
    WHEN MATCHED THEN UPDATE SET
      block_id = @block_id,
      route_id = @route_id,
      route_short_name = @route_short_name,
      direction_id = @direction_id,
      direction_label = @direction_label,
      origin_stop_id = @origin_stop_id,
      origin_stop_name = @origin_stop_name,
      scheduled_start_seconds = @scheduled_start_seconds,
      scheduled_start_at = @scheduled_start_at,
      -- in_rotation and rotation_day deliberately not refreshed: the deal for
      -- a day that already exists is a snapshot (spec §4.1).
      updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (
      service_date, trip_id, block_id, route_id, route_short_name, direction_id, direction_label,
      origin_stop_id, origin_stop_name, scheduled_start_seconds, scheduled_start_at, in_rotation, rotation_day
    ) VALUES (
      @service_date, @trip_id, @block_id, @route_id, @route_short_name, @direction_id, @direction_label,
      @origin_stop_id, @origin_stop_name, @scheduled_start_seconds, @scheduled_start_at, @in_rotation, @rotation_day
    )
    OUTPUT $action AS action;
  `);
  return result.recordset[0]?.action === "INSERT" ? "inserted" : "refreshed";
}

export async function materializeServiceDate(
  pool: sql.ConnectionPool,
  context: InvocationContext,
  serviceDate: string,
  dow: string,
): Promise<MaterializeResult> {
  const base: MaterializeResult = {
    service_date: serviceDate, outcome: "written", inserted: 0, refreshed: 0, rotation_count: 0, week_offset: null,
  };
  if (!(await schemaReady(pool))) {
    context.warn("Trip-start log schema is unavailable - apply migrations 027 and 094 before materialization can run.");
    return { ...base, outcome: "schema_missing" };
  }

  const { calendar, calendarDates } = await loadCalendar(pool);

  // The one import failure that looks like a success is a schedule that has
  // run out (see gtfsScheduleHorizon). Writing an empty day for it would read
  // as "no service" on the console; say so and leave the day absent instead.
  if (!serviceDateIsCovered(calendar, calendarDates, serviceDate, dow)) {
    context.warn(`Trip-start log: the imported schedule has no service on ${serviceDate} - nothing materialized. ` +
      "If this is not a genuine no-service day, the static GTFS feed has run out.");
    return { ...base, outcome: "no_service" };
  }

  const anchor = await resolveRotationAnchor(pool, context, calendar, calendarDates);
  if (!anchor) {
    context.warn("Trip-start log: no rotation anchor is set and none could be seeded from the schedule - nothing materialized.");
    return { ...base, outcome: "no_anchor" };
  }

  const serviceIds = await activeServiceIdsToday(pool, serviceDate, dow);
  const [rotationTrips, revenueTrips] = await Promise.all([
    loadRotationTrips(pool),
    loadRevenueTrips(pool, serviceDate, serviceIds),
  ]);
  const rotation = computeRotation(rotationTrips, calendar, calendarDates, anchor, serviceDate);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  let inserted = 0;
  let refreshed = 0;
  let rotationCount = 0;
  try {
    for (const trip of revenueTrips) {
      const action = await upsertTrip(tx, serviceDate, dow, trip, rotation);
      if (action === "inserted") inserted++;
      else if (action === "refreshed") refreshed++;
      if (action !== "skipped" && inRotation(rotation, trip.trip_id, dow)) rotationCount++;
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  context.log(
    `Trip-start log ${serviceDate} (${dow}): ${inserted} trips added, ${refreshed} refreshed, ` +
      `${rotationCount} on the verification list (week ${rotation.week_offset} from ${anchor}; ` +
      `pools ${rotation.weekday_pool_size} weekday / ${rotation.weekend_pool_size} weekend).`,
  );
  return { ...base, inserted, refreshed, rotation_count: rotationCount, week_offset: rotation.week_offset };
}

app.timer("tripStartLogMaterialize", {
  schedule: "0 30 9 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const pool = await getPool();
    const now = new Date();
    for (const dayOffset of [0, 1]) {
      const { serviceDate, dow } = agencyServiceDate(now, dayOffset);
      try {
        await materializeServiceDate(pool, context, serviceDate, dow);
      } catch (err) {
        context.error(`Trip-start log materialization failed for ${serviceDate}:`, err);
      }
    }
  },
});
