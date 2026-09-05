// Every minute: read the GTFS-RT TripUpdate feed and fill the Dispatch Log's
// actual starts (plans/dispatch-log-spec.md §4.2, §5). The rule itself is in
// lib/tripStartActuals.ts, with the feed measurements that decided it.
//
// This is a third reader of a feed two five-minute pollers already share
// through readTripUpdateFeed, which records the gtfs_trip_updates health row
// once per delivery. This poll deliberately does NOT go through it: a
// one-minute reader writing the same ledger would make that row describe a
// cadence neither of the other consumers has, and the trust contract names
// the feed, not the poller. Fetch failures are logged here instead.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { fetchTripUpdateFeed, type GtfsRtTripUpdate } from "../lib/gtfsTripUpdates";
import { agencyServiceDate } from "../lib/missedTripTime";
import { LINGER_WINDOW_SECONDS, planCapture, type StartCapture, type TripStartRow } from "../lib/tripStartActuals";
import type { TripStartActualSource, TripStartStatus } from "../lib/tripStartTypes";

interface WorkingRow {
  service_date: string;
  trip_id: string;
  origin_stop_id: string | null;
  first_stop_sequence: number | null;
  scheduled_start_at: Date;
  actual_start_at: Date | null;
  actual_start_source: TripStartActualSource | null;
  predicted_start_at: Date | null;
  start_status: TripStartStatus | null;
  first_underway_at: Date | null;
  missed: number | boolean;
}

export interface ActualsRunSummary {
  rows_considered: number;
  updates_in_feed: number;
  written: number;
  by_status: Record<string, number>;
}

/** Feed entities keyed the way TripStartLog is: service date + trip. */
export function indexTripUpdates(entities: ReadonlyArray<{ TripUpdate: GtfsRtTripUpdate | null }>): Map<string, GtfsRtTripUpdate> {
  const byKey = new Map<string, GtfsRtTripUpdate>();
  for (const entity of entities) {
    const update = entity.TripUpdate;
    if (!update) continue;
    byKey.set(`${update.Trip.StartDate ?? ""}|${update.Trip.TripId}`, update);
    // A producer that omits StartDate still names the trip; keep that reachable.
    if (!byKey.has(`|${update.Trip.TripId}`)) byKey.set(`|${update.Trip.TripId}`, update);
  }
  return byKey;
}

export function lookupTripUpdate(index: Map<string, GtfsRtTripUpdate>, serviceDate: string, tripId: string): GtfsRtTripUpdate | null {
  return index.get(`${serviceDate}|${tripId}`) ?? index.get(`|${tripId}`) ?? null;
}

async function schemaReady(pool: sql.ConnectionPool): Promise<boolean> {
  const result = await pool.request().query<{ ok: number }>(`
    SELECT CASE
      WHEN OBJECT_ID('dbo.TripStartLog', 'U') IS NOT NULL
       AND COL_LENGTH('dbo.TripStartLog', 'predicted_start_at') IS NOT NULL
       AND OBJECT_ID('dbo.GtfsScheduledTrips', 'U') IS NOT NULL
       AND OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NOT NULL
       AND OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NOT NULL
      THEN 1 ELSE 0 END AS ok
  `);
  return result.recordset[0]?.ok === 1;
}

// Today and yesterday: a trip scheduled at 23:50, or at a GTFS 25:10, is
// still yesterday's row when its first stop is realised after midnight.
async function loadWorkingSet(pool: sql.ConnectionPool, now: Date): Promise<WorkingRow[]> {
  const req = pool.request();
  req.input("today", sql.Char(8), agencyServiceDate(now).serviceDate);
  req.input("yesterday", sql.Char(8), agencyServiceDate(now, -1).serviceDate);
  req.input("linger", sql.Int, LINGER_WINDOW_SECONDS);
  const result = await req.query<WorkingRow>(`
    SELECT l.service_date, l.trip_id, l.origin_stop_id, st.first_stop_sequence,
           l.scheduled_start_at, l.actual_start_at, l.actual_start_source, l.predicted_start_at, l.start_status,
           ev.first_underway_at,
           CASE WHEN mmt.trip_id IS NOT NULL THEN 1 ELSE 0 END AS missed
    FROM TripStartLog l
    LEFT JOIN GtfsScheduledTrips st ON st.trip_id = l.trip_id
    LEFT JOIN GtfsTripOperationalEvidence ev
      ON ev.trip_id = l.trip_id AND ev.service_date = CAST(l.service_date AS NVARCHAR(20))
    LEFT JOIN MonitoredMissedTrips mmt
      ON mmt.trip_id = l.trip_id AND mmt.service_date = CAST(l.service_date AS NVARCHAR(20))
     AND mmt.validation_status <> 'false_positive'
    WHERE l.service_date IN (@today, @yesterday)
      AND (l.start_status IS NULL OR l.start_status <> 'canceled')
      AND (
        l.actual_start_at IS NULL
        OR (l.actual_start_source = 'trip_update' AND l.actual_start_at > DATEADD(SECOND, -@linger, SYSUTCDATETIME()))
      )
  `);
  return result.recordset;
}

async function writeCapture(pool: sql.ConnectionPool, row: WorkingRow, capture: StartCapture): Promise<void> {
  const req = pool.request();
  req.input("service_date", sql.Char(8), row.service_date);
  req.input("trip_id", sql.NVarChar, row.trip_id);
  req.input("actual_start_at", sql.DateTime2, capture.actual_start_at);
  req.input("actual_start_source", sql.NVarChar, capture.actual_start_source);
  req.input("start_delay_seconds", sql.Int, capture.start_delay_seconds);
  req.input("start_status", sql.NVarChar, capture.start_status);
  req.input("predicted_start_at", sql.DateTime2, capture.predicted_start_at);
  await req.query(`
    UPDATE TripStartLog SET
      actual_start_at = @actual_start_at,
      actual_start_source = @actual_start_source,
      start_delay_seconds = @start_delay_seconds,
      start_status = @start_status,
      predicted_start_at = @predicted_start_at,
      actuals_updated_at = SYSUTCDATETIME(),
      updated_at = SYSUTCDATETIME()
    WHERE service_date = @service_date AND trip_id = @trip_id
  `);
}

export async function runActualsPoll(
  pool: sql.ConnectionPool,
  context: InvocationContext,
  entities: ReadonlyArray<{ TripUpdate: GtfsRtTripUpdate | null }>,
  feedTimestamp: Date,
): Promise<ActualsRunSummary> {
  const summary: ActualsRunSummary = { rows_considered: 0, updates_in_feed: 0, written: 0, by_status: {} };
  const index = indexTripUpdates(entities);
  summary.updates_in_feed = entities.filter((e) => e.TripUpdate).length;
  const rows = await loadWorkingSet(pool, feedTimestamp);
  summary.rows_considered = rows.length;
  for (const row of rows) {
    const asRow: TripStartRow = { ...row, missed: Boolean(row.missed) };
    const capture = planCapture(asRow, lookupTripUpdate(index, row.service_date, row.trip_id), feedTimestamp);
    if (!capture) continue;
    try {
      await writeCapture(pool, row, capture);
      summary.written++;
      summary.by_status[capture.start_status] = (summary.by_status[capture.start_status] ?? 0) + 1;
    } catch (err) {
      context.error(`Trip-start actuals: failed to write ${row.trip_id} on ${row.service_date}:`, err);
    }
  }
  return summary;
}

app.timer("tripStartActualsPoll", {
  schedule: "0 * * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.GTFS_RT_TRIPUPDATE_URL;
    if (!feedUrl) {
      context.warn("GTFS_RT_TRIPUPDATE_URL is not configured - skipping this run.");
      return;
    }
    const pool = await getPool();
    if (!(await schemaReady(pool))) {
      context.warn("Trip-start actuals: schema is not ready - apply migrations 094 and 095 (and 027, 011) before actual starts can be captured.");
      return;
    }
    let feed;
    try {
      feed = await fetchTripUpdateFeed(feedUrl);
    } catch (err) {
      context.error("Trip-start actuals: failed to fetch the GTFS-RT TripUpdate feed:", err);
      return;
    }
    const feedTimestamp = feed.Header?.Timestamp ? new Date(feed.Header.Timestamp * 1000) : new Date();
    const summary = await runActualsPoll(pool, context, feed.Entities, feedTimestamp);
    const statuses = Object.entries(summary.by_status).map(([k, v]) => `${k}=${v}`).join(", ") || "none";
    context.log(
      `Trip-start actuals: ${summary.updates_in_feed} trip updates in feed, ${summary.rows_considered} rows open, ` +
        `${summary.written} written (${statuses}).`,
    );
  },
});
