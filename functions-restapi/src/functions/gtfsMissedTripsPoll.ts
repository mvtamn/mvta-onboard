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
//
// Ops definition of a missed trip (2026-08-06): a scheduled run that either
// never happens, or starts more than 30 minutes after its scheduled time.
// GRACE_MINUTES below drives both halves of that: the silent-no-show cutoff
// AND the late-arrival resolve threshold in resolveLateArrivals() - a trip
// that shows up 45 minutes late is still a missed trip, not a resolved one.
//
// Silent-no-show detection runs twice per poll, once for "today" and once
// for "yesterday" (dayOffset 0 / -1 in detectSilentNoShows). GTFS scheduled
// times legitimately exceed 24:00:00 for a trip that starts before midnight
// and runs past it, and a trip's 30-minute grace deadline can itself fall
// after midnight even for an ordinary same-day trip (e.g. one scheduled at
// 23:50). A single wall-clock-seconds-since-midnight comparison can never
// reach those trips - by the time enough real time has passed to declare
// them missed, "today" has already rolled over and they've fallen out of
// scope. Re-checking "yesterday" every poll (cheap - NOT EXISTS filters keep
// it a no-op once a trip is observed or already tracked) closes that gap
// without needing a separate rollover job.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { sql } from "../lib/db";
import { readTripUpdateFeed } from "../lib/gtfsTripUpdateIngest";
import { mapCanceledTrip, type CanceledTrip } from "../lib/gtfsTripUpdates";
import { agencyServiceDate, serviceDateAndGtfsSecondsToUtc } from "../lib/missedTripTime";
import { underwayEvidenceCoverage } from "../lib/kpiTrust";
import { loadKpiFeedHealthRecords } from "../lib/kpiTrustStore";

const GRACE_MINUTES = 30; // ops definition: never-ran OR started >30 min late = missed
const GRACE_SECONDS = GRACE_MINUTES * 60;

function silentNoShowEnabled(): boolean {
  return process.env.GTFS_SILENT_NO_SHOW_ENABLED?.trim().toLowerCase() === "true";
}

// Whether this poll can trust "no vehicle-start evidence" to mean "the trip
// did not run". See resolveNoShowCoverage.
type NoShowCoverage = {
  proven: boolean;
  reason: string;
  gapStatusSupported: boolean;
};

// Silent-no-show detection is an inference from absence: a scheduled trip with
// no positive vehicle-start evidence by its grace deadline is declared missed.
// That inference is only valid while gtfs_vehicle_positions - the sole feed
// that writes first_underway_at - was itself current. When it was stale, down,
// or never delivered, every scheduled trip in the window looks identical to a
// no-show, and flagging them turns an ingestion outage into a queue of
// compliance findings no reviewer can disprove.
//
// Resolved against the shared fixed_route_missed_trips contract (the same one
// the console's trust banner renders) rather than a local freshness rule, and
// failing closed: an unreadable ledger counts as unproven coverage.
async function resolveNoShowCoverage(
  pool: sql.ConnectionPool,
  context: InvocationContext,
): Promise<NoShowCoverage> {
  let proven = false;
  let reason = "vehicle-position feed health could not be read";
  try {
    const positions = underwayEvidenceCoverage(await loadKpiFeedHealthRecords(pool));
    proven = positions.state === "current";
    reason = proven
      ? ""
      : `gtfs_vehicle_positions is ${positions.state}` +
        (positions.last_success_at ? ` (last success ${positions.last_success_at})` : " (no successful ingestion recorded)");
  } catch (err) {
    context.error("Failed to resolve vehicle-position coverage for silent no-show detection:", err);
  }

  // Migration 087 widens the data_quality_status CHECK. Until it is applied,
  // an undecidable trip cannot be recorded as one, so it is left untracked and
  // re-examined next poll rather than mislabelled as a confirmed no-show.
  let gapStatusSupported = false;
  try {
    const check = await pool.request().query<{ ok: number }>(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.MonitoredMissedTrips')
          AND CHARINDEX('unknown_data_gap', definition) > 0
      ) THEN 1 ELSE 0 END AS ok
    `);
    gapStatusSupported = check.recordset[0]?.ok === 1;
  } catch (err) {
    context.error("Failed to check whether MonitoredMissedTrips accepts unknown_data_gap:", err);
  }

  return { proven, reason, gapStatusSupported };
}

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

  return serviceDateAndGtfsSecondsToUtc(serviceDate, seconds);
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
      trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type,
      detector_version, data_quality_status
    )
    VALUES (
      @trip_id, @service_date, @route_id, @scheduled_departure_at, @grace_deadline_at,
      'escalated', 'explicit_cancellation', 'gtfs-cancel-v1', 'source_verified'
    )
  `);
  context.log(`Missed trip flagged for review (canceled): trip ${trip.trip_id} (route ${trip.route_id}, service date ${serviceDate})`);
  return true;
}

interface ScheduledTripRow {
  trip_id: string;
  route_id: string;
  first_departure_seconds: number;
  first_underway_at: Date | null;
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

// dayOffset 0 = "today" (catches trips whose 30-min grace deadline falls
// before midnight); dayOffset -1 = "yesterday" (catches trips whose deadline
// falls after midnight - either an ordinary late-evening trip, e.g. one
// scheduled 23:50, or one using GTFS's >24:00:00 past-midnight time
// convention). elapsedSeconds is uncapped (can exceed 86400) so it can reach
// those trips' first_departure_seconds, which are stored on the same
// uncapped scale. See the module header comment for why both passes run
// every poll rather than just after midnight.
async function detectSilentNoShows(
  pool: sql.ConnectionPool,
  context: InvocationContext,
  dayOffset: number,
  coverage: NoShowCoverage,
): Promise<number> {
  const scheduleTablesExist = await pool.request().query<{ ok: number }>(`
    SELECT CASE
      WHEN OBJECT_ID('dbo.GtfsCalendar', 'U') IS NOT NULL
       AND OBJECT_ID('dbo.GtfsCalendarDates', 'U') IS NOT NULL
       AND OBJECT_ID('dbo.GtfsScheduledTrips', 'U') IS NOT NULL
       AND COL_LENGTH('dbo.GtfsScheduledTrips', 'first_stop_id') IS NOT NULL
       AND COL_LENGTH('dbo.GtfsScheduledTrips', 'first_stop_sequence') IS NOT NULL
       AND COL_LENGTH('dbo.GtfsScheduledTrips', 'block_id') IS NOT NULL
      THEN 1 ELSE 0 END AS ok
  `);
  if (scheduleTablesExist.recordset[0]?.ok !== 1) {
    context.warn("The complete GTFS schedule schema is unavailable - apply migration 027 before schedule-based detection can run.");
    return 0;
  }
  const evidenceTableCheck = await pool.request().query<{ ok: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NULL THEN 0 ELSE 1 END AS ok
  `);
  if (evidenceTableCheck.recordset[0]?.ok !== 1) {
    context.warn("GtfsTripOperationalEvidence does not exist - apply migration 027 before enabling silent no-shows.");
    return 0;
  }

  const now = new Date();
  const { serviceDate, dow } = agencyServiceDate(now, dayOffset);

  const serviceIds = await activeServiceIdsToday(pool, serviceDate, dow);
  if (serviceIds.length === 0) return 0;

  const req = pool.request();
  req.input("service_date", sql.NVarChar, serviceDate);
  const serviceIdParams = serviceIds.map((_, i) => `@sid${i}`).join(", ");
  serviceIds.forEach((id, i) => req.input(`sid${i}`, sql.NVarChar, id));

  // Fetch the still-unobserved/untracked scheduled trips for this service
  // date, then compare real UTC instants in TypeScript. Comparing raw GTFS
  // seconds with UTC seconds-since-midnight was five hours early during CDT
  // (six during CST) and cannot safely handle DST or >24:00:00 times.
  //
  // Excludes routes actively classified as SpecialEvent (migration-016):
  // a base-schedule trip on a route that's been overridden for a special
  // event may legitimately not run that service day even though it's still
  // sitting in the static GtfsScheduledTrips import - without this filter
  // that reads as a silent no-show for a trip nobody ever intended to run.
  // Explicit GTFS-RT cancellations (flagCanceled) aren't filtered this way
  // since those are a real-time signal, not an inference from the schedule.
  const candidateTrips = await req.query<ScheduledTripRow>(`
    SELECT st.trip_id, st.route_id, st.first_departure_seconds, evidence.first_underway_at
    FROM GtfsScheduledTrips st
    LEFT JOIN GtfsTripOperationalEvidence evidence
      ON evidence.trip_id = st.trip_id AND evidence.service_date = @service_date
    WHERE st.service_id IN (${serviceIdParams})
      AND NOT EXISTS (
        SELECT 1 FROM MonitoredMissedTrips mmt
        WHERE mmt.trip_id = st.trip_id AND mmt.service_date = @service_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM RouteClassification rc
        WHERE CAST(rc.route_id AS NVARCHAR(50)) = st.route_id
          AND rc.route_category = 'SpecialEvent'
          AND rc.is_active = 1
          AND (rc.effective_start_date IS NULL OR rc.effective_start_date <= @service_date)
          AND (rc.effective_end_date IS NULL OR rc.effective_end_date >= @service_date)
      )
  `);

  let flaggedCount = 0;
  let recordedGaps = 0;
  let unrecordableGaps = 0;
  for (const trip of candidateTrips.recordset) {
    const scheduledAt = serviceDateAndGtfsSecondsToUtc(serviceDate, trip.first_departure_seconds);
    if (!scheduledAt) continue;
    const graceDeadline = new Date(scheduledAt.getTime() + GRACE_SECONDS * 1000);
    if (graceDeadline.getTime() > now.getTime()) continue;
    if (trip.first_underway_at && trip.first_underway_at.getTime() <= graceDeadline.getTime()) continue;

    // Undecidable, not missed: the feed that would have proven this trip ran
    // was not current, so its silence says nothing about the trip.
    if (!coverage.proven && !coverage.gapStatusSupported) {
      unrecordableGaps++;
      continue;
    }

    try {
      const trackReq = pool.request();
      trackReq.input("trip_id", sql.NVarChar, trip.trip_id);
      trackReq.input("service_date", sql.NVarChar, serviceDate);
      trackReq.input("route_id", sql.NVarChar, trip.route_id);
      trackReq.input("scheduled_departure_at", sql.DateTime2, scheduledAt);
      trackReq.input("grace_deadline_at", sql.DateTime2, graceDeadline);
      // A data-gap row is recorded, never escalated: it stays out of the review
      // queue and the compliance tiles, and reconcileUnderwayEvidence still
      // resolves it if the feed recovers and late evidence arrives.
      trackReq.input("status", sql.NVarChar, coverage.proven ? "escalated" : "watching");
      trackReq.input("data_quality_status", sql.NVarChar, coverage.proven ? "experimental" : "unknown_data_gap");
      await trackReq.query(`
        INSERT INTO MonitoredMissedTrips (
          trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type,
          detector_version, data_quality_status
        )
        VALUES (
          @trip_id, @service_date, @route_id, @scheduled_departure_at, @grace_deadline_at,
          @status, 'silent_no_show', 'gtfs-silent-v2', @data_quality_status
        )
      `);
      if (coverage.proven) {
        flaggedCount++;
        context.log(`Missed trip flagged for review (no-show): trip ${trip.trip_id} (route ${trip.route_id}, scheduled ${scheduledAt.toISOString()})`);
      } else {
        recordedGaps++;
      }
    } catch (err) {
      context.error(`Failed to flag no-show for trip ${trip.trip_id}:`, err);
    }
  }

  if (!coverage.proven && (recordedGaps > 0 || unrecordableGaps > 0)) {
    context.warn(
      `Silent no-show detection could not decide ${recordedGaps + unrecordableGaps} scheduled trip(s) for ${serviceDate}: ` +
        `${coverage.reason}. ${recordedGaps} recorded as unknown_data_gap, ` +
        `${unrecordableGaps} left untracked (apply migration 087 to record them).`,
    );
  }
  return flaggedCount;
}

// Only positive vehicle progress can resolve a schedule-absence candidate.
// TripUpdate presence is intentionally excluded: prediction feeds can list a
// future trip hours before it begins. first_underway_at is written by the
// VehiclePosition poller only after the vehicle progresses beyond the static
// trip's first stop sequence.
async function reconcileUnderwayEvidence(pool: sql.ConnectionPool, context: InvocationContext): Promise<void> {
  try {
    const tableCheck = await pool.request().query<{ table_exists: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NULL
        THEN 0 ELSE 1 END AS table_exists
    `);
    if (tableCheck.recordset[0]?.table_exists !== 1) return;
    await pool.request().query(`
      UPDATE mmt
      SET status = 'resolved',
          detected_late_arrival_at = evidence.first_underway_at,
          last_checked_at = SYSUTCDATETIME()
      FROM MonitoredMissedTrips mmt
      INNER JOIN GtfsTripOperationalEvidence evidence
        ON evidence.trip_id = mmt.trip_id AND evidence.service_date = mmt.service_date
      WHERE mmt.detection_type = 'silent_no_show'
        AND mmt.data_quality_status IN ('experimental', 'unknown_data_gap')
        AND mmt.status IN ('watching', 'escalated')
        AND evidence.first_underway_at IS NOT NULL
        AND evidence.first_underway_at <= mmt.grace_deadline_at;

      UPDATE mmt
      SET detected_late_arrival_at = evidence.first_underway_at,
          -- Late evidence decides a trip the outage left undecidable: it did
          -- run, past its grace deadline, which is a missed trip by the ops
          -- definition. Promote it out of the data-gap bucket into the queue.
          status = CASE WHEN mmt.data_quality_status = 'unknown_data_gap' THEN 'escalated' ELSE mmt.status END,
          data_quality_status = CASE WHEN mmt.data_quality_status = 'unknown_data_gap' THEN 'experimental' ELSE mmt.data_quality_status END,
          last_checked_at = SYSUTCDATETIME()
      FROM MonitoredMissedTrips mmt
      INNER JOIN GtfsTripOperationalEvidence evidence
        ON evidence.trip_id = mmt.trip_id AND evidence.service_date = mmt.service_date
      WHERE mmt.detection_type = 'silent_no_show'
        AND mmt.data_quality_status IN ('experimental', 'unknown_data_gap')
        AND mmt.status IN ('watching', 'escalated')
        AND evidence.first_underway_at > mmt.grace_deadline_at
        AND mmt.detected_late_arrival_at IS NULL;
    `);
  } catch (err) {
    context.error("Failed to reconcile positive vehicle-start evidence:", err);
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

    const ingest = await readTripUpdateFeed(feedUrl, context);
    if (!ingest) return;
    const { feed, pool } = ingest;
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
    const noShowEnabled = silentNoShowEnabled();
    if (noShowEnabled) {
      // Both offsets run every poll - see the module header comment for why
      // "yesterday" needs rechecking too (late-evening and past-midnight
      // trips' grace deadlines fall after the calendar day rolls over).
      const coverage = await resolveNoShowCoverage(pool, context);
      for (const dayOffset of [0, -1]) {
        try {
          noShowCount += await detectSilentNoShows(pool, context, dayOffset, coverage);
        } catch (err) {
          context.error(`Failed to run silent no-show detection (dayOffset=${dayOffset}):`, err);
        }
      }
    } else {
      context.warn(
        "GTFS silent-no-show detection is paused (GTFS_SILENT_NO_SHOW_ENABLED is not true); explicit cancellations remain active.",
      );
    }

    await reconcileUnderwayEvidence(pool, context);

    context.log(
      `Missed-trip poll: ${feed.Entities.length} entities seen, ${canceledCount} cancellations flagged, ` +
        `${noShowCount} silent no-shows flagged (enabled=${noShowEnabled}).`,
    );
  },
});
