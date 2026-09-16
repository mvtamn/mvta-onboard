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
// A silent no-show is an inference from absence, and four things other than a
// missed trip produce the same silence. Each is checked before a trip is
// judged, and each has its own recorded reason (migration 121) so the remedy is
// visible: the observing feed was not current, the static schedule is too old
// or no longer describes what the realtime feeds are carrying, no vehicle on
// this trip's whole block reported a position all day, or the block's bus
// demonstrably operated both before and after this trip and so was working
// throughout the window the trip is supposed to have vanished from. The rules
// themselves are pure functions in lib/missedTripConfidence.ts; this file only
// applies them.
//
// Nothing is escalated on a single observation either. A trip past its deadline
// with no evidence is recorded as held, and only a LATER poll that still finds
// nothing turns it into a finding (confirmPendingNoShows). One missed fetch
// cannot raise a compliance candidate.
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
import { activeServiceIdsToday } from "../lib/gtfsScheduleHorizon";
import { underwayEvidenceCoverage } from "../lib/kpiTrust";
import { loadKpiFeedHealthRecords } from "../lib/kpiTrustStore";
import {
  AWAITING_CONFIRMATION,
  NO_SHOW_CONFIRMATION_SECONDS,
  blockContinuity,
  noShowDecision,
  scheduleAgreement,
  staticScheduleConfidence,
  type BlockTripEvidence,
  type ScheduleConfidence,
} from "../lib/missedTripConfidence";

const GRACE_MINUTES = 30; // ops definition: never-ran OR started >30 min late = missed
const GRACE_SECONDS = GRACE_MINUTES * 60;

function silentNoShowEnabled(): boolean {
  return process.env.GTFS_SILENT_NO_SHOW_ENABLED?.trim().toLowerCase() === "true";
}

// What this poll is allowed to conclude from absence, and what it is able to
// record. See resolveDetectionConfidence; the rules themselves live in
// missedTripConfidence.ts.
type DetectionConfidence = {
  /** gtfs_vehicle_positions was current, so missing evidence means something. */
  coverageProven: boolean;
  coverageReason: string;
  /** The static import is recent enough to describe today's service. */
  staticSchedule: ScheduleConfidence;
  /** Migration 087: data_quality_status accepts 'unknown_data_gap'. */
  gapStatusSupported: boolean;
  /** Migration 121: MonitoredMissedTrips.undecided_reason exists. */
  reasonColumnSupported: boolean;
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
//
// The static schedule is resolved here too, and for the same reason from the
// other direction: the feed can be current while the schedule it is being
// compared against describes a service pattern the agency stopped running.
async function resolveDetectionConfidence(
  pool: sql.ConnectionPool,
  context: InvocationContext,
): Promise<DetectionConfidence> {
  let coverageProven = false;
  let coverageReason = "vehicle-position feed health could not be read";
  let staticSchedule: ScheduleConfidence = {
    trusted: false,
    explanation: "static GTFS feed health could not be read",
  };
  try {
    const health = await loadKpiFeedHealthRecords(pool);
    const positions = underwayEvidenceCoverage(health);
    coverageProven = positions.state === "current";
    coverageReason = coverageProven
      ? ""
      : `gtfs_vehicle_positions is ${positions.state}` +
        (positions.last_success_at ? ` (last success ${positions.last_success_at})` : " (no successful ingestion recorded)");
    staticSchedule = staticScheduleConfidence(health);
  } catch (err) {
    context.error("Failed to resolve feed confidence for silent no-show detection:", err);
  }

  // Migration 087 widens the data_quality_status CHECK. Until it is applied,
  // an undecidable trip cannot be recorded as one, so it is left untracked and
  // re-examined next poll rather than mislabelled as a confirmed no-show.
  let gapStatusSupported = false;
  let reasonColumnSupported = false;
  try {
    const check = await pool.request().query<{ gap_ok: number; reason_ok: number }>(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.MonitoredMissedTrips')
          AND CHARINDEX('unknown_data_gap', definition) > 0
      ) THEN 1 ELSE 0 END AS gap_ok,
      CASE WHEN COL_LENGTH('dbo.MonitoredMissedTrips', 'undecided_reason') IS NULL
        THEN 0 ELSE 1 END AS reason_ok
    `);
    gapStatusSupported = check.recordset[0]?.gap_ok === 1;
    reasonColumnSupported = check.recordset[0]?.reason_ok === 1;
  } catch (err) {
    context.error("Failed to check MonitoredMissedTrips' detector columns:", err);
  }

  return { coverageProven, coverageReason, staticSchedule, gapStatusSupported, reasonColumnSupported };
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
  block_id: string | null;
  first_departure_seconds: number;
  first_underway_at: Date | null;
  /** Any vehicle position at all for this trip, underway or not. */
  first_vehicle_position_at: Date | null;
  /** Any TripUpdate at all - the feed had heard of this trip id. */
  first_trip_update_at: Date | null;
  /** A MonitoredMissedTrips row already exists for this trip and date. */
  already_tracked: boolean;
  /** Excluded from detection by an active SpecialEvent classification. */
  special_event: boolean;
}

/** What the detector counted this run, for the poll log. */
interface NoShowTally {
  pending: number;
  undecided: number;
  unrecordable: number;
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
  confidence: DetectionConfidence,
): Promise<NoShowTally> {
  const nothing: NoShowTally = { pending: 0, undecided: 0, unrecordable: 0 };
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
    return nothing;
  }
  const evidenceTableCheck = await pool.request().query<{ ok: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NULL THEN 0 ELSE 1 END AS ok
  `);
  if (evidenceTableCheck.recordset[0]?.ok !== 1) {
    context.warn("GtfsTripOperationalEvidence does not exist - apply migration 027 before enabling silent no-shows.");
    return nothing;
  }

  const now = new Date();
  const { serviceDate, dow } = agencyServiceDate(now, dayOffset);

  const serviceIds = await activeServiceIdsToday(pool, serviceDate, dow);
  if (serviceIds.length === 0) return nothing;

  const req = pool.request();
  req.input("service_date", sql.NVarChar, serviceDate);
  const serviceIdParams = serviceIds.map((_, i) => `@sid${i}`).join(", ");
  serviceIds.forEach((id, i) => req.input(`sid${i}`, sql.NVarChar, id));

  // Every scheduled trip for this service date with whatever the realtime feeds
  // have recorded against it, then compare real UTC instants in TypeScript.
  // Comparing raw GTFS seconds with UTC seconds-since-midnight was five hours
  // early during CDT (six during CST) and cannot safely handle DST or
  // >24:00:00 times.
  //
  // The already-tracked and SpecialEvent filters used to be WHERE clauses. They
  // are SELECTed flags now because the schedule-agreement guard below needs the
  // whole day's population to divide by: filtering first would measure only the
  // trips that have not been decided yet, which on a bad day is the very set
  // that makes the schedule look broken.
  //
  // SpecialEvent (migration-016): a base-schedule trip on a route that has been
  // overridden for a special event may legitimately not run that service day
  // even though it is still sitting in the static GtfsScheduledTrips import -
  // without this filter that reads as a silent no-show for a trip nobody ever
  // intended to run. Explicit GTFS-RT cancellations (flagCanceled) aren't
  // filtered this way since those are a real-time signal, not an inference from
  // the schedule.
  const scheduledTrips = await req.query<ScheduledTripRow>(`
    SELECT st.trip_id, st.route_id, st.block_id, st.first_departure_seconds,
           evidence.first_underway_at, evidence.first_vehicle_position_at, evidence.first_trip_update_at,
           CAST(CASE WHEN EXISTS (
             SELECT 1 FROM MonitoredMissedTrips mmt
             WHERE mmt.trip_id = st.trip_id AND mmt.service_date = @service_date
           ) THEN 1 ELSE 0 END AS BIT) AS already_tracked,
           CAST(CASE WHEN EXISTS (
             SELECT 1 FROM RouteClassification rc
             WHERE CAST(rc.route_id AS NVARCHAR(50)) = st.route_id
               AND rc.route_category = 'SpecialEvent'
               AND rc.is_active = 1
               AND (rc.effective_start_date IS NULL OR rc.effective_start_date <= @service_date)
               AND (rc.effective_end_date IS NULL OR rc.effective_end_date >= @service_date)
           ) THEN 1 ELSE 0 END AS BIT) AS special_event
    FROM GtfsScheduledTrips st
    LEFT JOIN GtfsTripOperationalEvidence evidence
      ON evidence.trip_id = st.trip_id AND evidence.service_date = @service_date
    WHERE st.service_id IN (${serviceIdParams})
  `);

  // One pass over the day to establish what the day itself can support, before
  // any single trip is judged by it.
  //
  // Agreement denominator: trips whose deadline has passed. A trip still within
  // its grace window has had no chance to appear yet, and counting it would
  // make every morning look like a schedule mismatch.
  //
  // Block ledger: every block's trips in one list, each carrying whether it
  // reported a position at all and whether it demonstrably operated. The two
  // are different questions and both are asked. A position proves the
  // transponder is alive, so a block with none all day cannot testify about any
  // of its trips; operating proves the bus was actually working that trip, which
  // is what makes it a witness for its neighbours. blockContinuity reads this
  // per candidate.
  const deadlineFor = (trip: ScheduledTripRow): Date | null => {
    const scheduledAt = serviceDateAndGtfsSecondsToUtc(serviceDate, trip.first_departure_seconds);
    return scheduledAt ? new Date(scheduledAt.getTime() + GRACE_SECONDS * 1000) : null;
  };
  let deadlinePassed = 0;
  let knownToFeed = 0;
  const blocks = new Map<string, BlockTripEvidence[]>();
  for (const trip of scheduledTrips.recordset) {
    if (trip.block_id) {
      const blockTrips = blocks.get(trip.block_id) ?? [];
      blockTrips.push({
        departureSeconds: trip.first_departure_seconds,
        operated: trip.first_underway_at !== null,
        reportedPosition: trip.first_vehicle_position_at !== null,
      });
      blocks.set(trip.block_id, blockTrips);
    }
    const deadline = deadlineFor(trip);
    if (!deadline || deadline.getTime() > now.getTime()) continue;
    deadlinePassed++;
    if (trip.first_trip_update_at !== null || trip.first_vehicle_position_at !== null) knownToFeed++;
  }
  const agreement = scheduleAgreement({ deadlinePassed, knownToFeed });

  const tally: NoShowTally = { pending: 0, undecided: 0, unrecordable: 0 };
  const undecidedBy = new Map<string, number>();
  for (const trip of scheduledTrips.recordset) {
    if (trip.already_tracked || trip.special_event) continue;
    const scheduledAt = serviceDateAndGtfsSecondsToUtc(serviceDate, trip.first_departure_seconds);
    if (!scheduledAt) continue;
    const graceDeadline = new Date(scheduledAt.getTime() + GRACE_SECONDS * 1000);
    if (graceDeadline.getTime() > now.getTime()) continue;
    if (trip.first_underway_at && trip.first_underway_at.getTime() <= graceDeadline.getTime()) continue;

    const blockTrips = trip.block_id ? blocks.get(trip.block_id) : undefined;
    const decision = noShowDecision({
      vehiclePositionsCurrent: confidence.coverageProven,
      staticSchedule: confidence.staticSchedule,
      agreement,
      block: blockTrips ? blockContinuity(blockTrips, trip.first_departure_seconds) : null,
    });

    // Undecidable, not missed - but the row can only say so where migration 087
    // widened the CHECK. Without it the trip is left untracked and re-examined
    // next poll rather than mislabelled as a confirmed no-show.
    if (decision.outcome === "undecidable" && !confidence.gapStatusSupported) {
      tally.unrecordable++;
      undecidedBy.set(decision.reason, (undecidedBy.get(decision.reason) ?? 0) + 1);
      continue;
    }
    // Holding a trip for a second poll needs somewhere to record that it is
    // being held, which is migration 121's column. Without it the detector
    // falls back to what it did before confirmation existed - escalate on the
    // single observation - rather than holding rows it could never release.
    // Degrading to the old behaviour is a known quantity; degrading to silence
    // would turn a pending migration into a detector that reports nothing while
    // looking healthy.
    const confirmationAvailable = confidence.reasonColumnSupported;
    const escalateOnSight = decision.outcome === "pending" && !confirmationAvailable;

    try {
      const trackReq = pool.request();
      trackReq.input("trip_id", sql.NVarChar, trip.trip_id);
      trackReq.input("service_date", sql.NVarChar, serviceDate);
      trackReq.input("route_id", sql.NVarChar, trip.route_id);
      trackReq.input("scheduled_departure_at", sql.DateTime2, scheduledAt);
      trackReq.input("grace_deadline_at", sql.DateTime2, graceDeadline);
      // Neither outcome is normally escalated on sight. A pending row waits for
      // a second poll (confirmPendingNoShows); an undecidable one waits for
      // evidence that may never come. Both stay out of the review queue and the
      // compliance tiles meanwhile, and reconcileUnderwayEvidence still resolves
      // either if the trip turns out to have run.
      trackReq.input("status", sql.NVarChar, escalateOnSight ? "escalated" : "watching");
      trackReq.input(
        "data_quality_status",
        sql.NVarChar,
        decision.outcome === "pending" ? "experimental" : "unknown_data_gap",
      );
      const reasonColumn = confirmationAvailable ? ", undecided_reason" : "";
      const reasonValue = confirmationAvailable ? ", @undecided_reason" : "";
      if (confirmationAvailable) {
        trackReq.input("undecided_reason", sql.NVarChar, decision.reason);
      }
      await trackReq.query(`
        INSERT INTO MonitoredMissedTrips (
          trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type,
          detector_version, data_quality_status${reasonColumn}
        )
        VALUES (
          @trip_id, @service_date, @route_id, @scheduled_departure_at, @grace_deadline_at,
          @status, 'silent_no_show', 'gtfs-silent-v3', @data_quality_status${reasonValue}
        )
      `);
      if (decision.outcome === "pending") {
        tally.pending++;
        if (escalateOnSight) {
          context.log(`Missed trip flagged for review (no-show, unconfirmed): trip ${trip.trip_id} (route ${trip.route_id}, scheduled ${scheduledAt.toISOString()})`);
        }
      } else {
        tally.undecided++;
        undecidedBy.set(decision.reason, (undecidedBy.get(decision.reason) ?? 0) + 1);
      }
    } catch (err) {
      context.error(`Failed to record no-show candidate for trip ${trip.trip_id}:`, err);
    }
  }

  if (undecidedBy.size > 0) {
    const detail = [...undecidedBy.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ");
    context.warn(
      `Silent no-show detection could not decide ${tally.undecided + tally.unrecordable} scheduled trip(s) for ` +
        `${serviceDate} (${detail}). ${tally.unrecordable} could not be recorded at all - apply migrations 087 and 121.` +
        (confidence.coverageProven ? "" : ` Position coverage: ${confidence.coverageReason}.`) +
        (confidence.staticSchedule.explanation ? ` Schedule: ${confidence.staticSchedule.explanation}.` : "") +
        (agreement.explanation ? ` Agreement: ${agreement.explanation}.` : ""),
    );
  }
  return tally;
}

// Item 4 of the false-positive guards: a second observation before a detection
// becomes a finding.
//
// detectSilentNoShows records a trip the first time it passes its deadline with
// no underway evidence, and stops there. This promotes it only if a LATER poll
// still finds nothing - the row must have been sitting for at least
// NO_SHOW_CONFIRMATION_SECONDS, which is shorter than the five-minute poll
// interval, so the next run always qualifies and the run that created it never
// can.
//
// What that buys: a single failed feed fetch, a vendor publish that ran late, or
// a position that landed a few seconds the wrong side of the deadline no longer
// produces a finding on its own. It costs five minutes of latency on a
// compliance tool nobody watches in real time.
//
// Runs after reconcileUnderwayEvidence, so a trip that turned out to have run in
// the meantime is resolved (or recorded as genuinely late) before this pass can
// see it.
async function confirmPendingNoShows(pool: sql.ConnectionPool, context: InvocationContext): Promise<number> {
  try {
    const ready = await pool.request().query<{ ok: number }>(`
      SELECT CASE WHEN COL_LENGTH('dbo.MonitoredMissedTrips', 'undecided_reason') IS NULL
        THEN 0 ELSE 1 END AS ok
    `);
    if (ready.recordset[0]?.ok !== 1) return 0;

    const req = pool.request();
    req.input("reason", sql.NVarChar, AWAITING_CONFIRMATION);
    req.input("wait_seconds", sql.Int, NO_SHOW_CONFIRMATION_SECONDS);
    const result = await req.query(`
      UPDATE mmt
      SET status = 'escalated',
          undecided_reason = NULL,
          last_checked_at = SYSUTCDATETIME()
      FROM MonitoredMissedTrips mmt
      LEFT JOIN GtfsTripOperationalEvidence evidence
        ON evidence.trip_id = mmt.trip_id AND evidence.service_date = mmt.service_date
      WHERE mmt.undecided_reason = @reason
        AND mmt.status = 'watching'
        AND mmt.first_seen_watching_at <= DATEADD(SECOND, -@wait_seconds, SYSUTCDATETIME())
        AND evidence.first_underway_at IS NULL
    `);
    const confirmed = result.rowsAffected[0] ?? 0;
    if (confirmed > 0) context.log(`Missed trips confirmed on a second poll: ${confirmed}.`);
    return confirmed;
  } catch (err) {
    context.error("Failed to confirm pending no-show candidates:", err);
    return 0;
  }
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
    // Migration 121's column is cleared alongside the status wherever it
    // exists: a decided row must not keep saying why it was undecided. The two
    // statements are built with the column only when it is there, so an
    // environment still on 120 reconciles exactly as before.
    const reasonReady = await pool.request().query<{ ok: number }>(`
      SELECT CASE WHEN COL_LENGTH('dbo.MonitoredMissedTrips', 'undecided_reason') IS NULL
        THEN 0 ELSE 1 END AS ok
    `);
    const clearReason = reasonReady.recordset[0]?.ok === 1 ? "undecided_reason = NULL," : "";
    // A held row is one the detector has not finished deciding, so late
    // evidence decides it the same way an outage-gap row is decided: the trip
    // ran, past its deadline, which is a missed trip by the ops definition.
    const heldOrGap = reasonReady.recordset[0]?.ok === 1
      ? "(mmt.data_quality_status = 'unknown_data_gap' OR mmt.undecided_reason IS NOT NULL)"
      : "mmt.data_quality_status = 'unknown_data_gap'";
    await pool.request().query(`
      UPDATE mmt
      SET status = 'resolved',
          ${clearReason}
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
          -- Late evidence decides a trip the detector left undecided - whether
          -- an outage, a suspect schedule, a silent block, or a row still
          -- waiting on its second poll. It did run, past its grace deadline,
          -- which is a missed trip by the ops definition, so it is promoted out
          -- of the held bucket into the queue.
          status = CASE WHEN ${heldOrGap} THEN 'escalated' ELSE mmt.status END,
          data_quality_status = CASE WHEN ${heldOrGap} THEN 'experimental' ELSE mmt.data_quality_status END,
          ${clearReason}
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

    const detected: NoShowTally = { pending: 0, undecided: 0, unrecordable: 0 };
    const noShowEnabled = silentNoShowEnabled();
    if (noShowEnabled) {
      // Both offsets run every poll - see the module header comment for why
      // "yesterday" needs rechecking too (late-evening and past-midnight
      // trips' grace deadlines fall after the calendar day rolls over).
      const confidence = await resolveDetectionConfidence(pool, context);
      for (const dayOffset of [0, -1]) {
        try {
          const tally = await detectSilentNoShows(pool, context, dayOffset, confidence);
          detected.pending += tally.pending;
          detected.undecided += tally.undecided;
          detected.unrecordable += tally.unrecordable;
        } catch (err) {
          context.error(`Failed to run silent no-show detection (dayOffset=${dayOffset}):`, err);
        }
      }
    } else {
      context.warn(
        "GTFS silent-no-show detection is paused (GTFS_SILENT_NO_SHOW_ENABLED is not true); explicit cancellations remain active.",
      );
    }

    // Order matters: evidence first, so a trip that turned out to have run is
    // resolved (or recorded as genuinely late) before the confirmation pass can
    // promote it into the queue.
    await reconcileUnderwayEvidence(pool, context);
    const confirmed = await confirmPendingNoShows(pool, context);

    context.log(
      `Missed-trip poll: ${feed.Entities.length} entities seen, ${canceledCount} cancellations flagged, ` +
        `${detected.pending} no-show candidates detected, ${confirmed} confirmed on a later poll, ` +
        `${detected.undecided} recorded undecided, ${detected.unrecordable} unrecordable ` +
        `(enabled=${noShowEnabled}).`,
    );
  },
});
