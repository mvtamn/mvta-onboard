// GTFS source adapter for the Missed-trip case module: turns the TripUpdate
// feed, the static schedule and the stored operational evidence into
// observations. It decides nothing about cases - it reports what the sources
// show, and the module decides.
//
// Three kinds of observation:
//
// 1. Explicit cancellation: the GTFS-RT TripUpdate feed carries
//    schedule_relationship = CANCELED for a trip the agency's own dispatch
//    pulled.
// 2. Silent no-show: a scheduled trip past its 30-minute deadline with no
//    positive start evidence. A silent no-show is an inference from absence,
//    and four things other than a missed trip produce the same silence - a feed
//    that was not current, a static schedule that is stale or no longer
//    describes what the realtime feeds carry, a block whose vehicle never
//    reported, or a block whose bus demonstrably worked throughout. The rules
//    are pure functions in lib/missedTripConfidence.ts; each undecidable trip is
//    reported with its reason. A trip is reported every pass until it starts,
//    which is how the module's second-poll confirmation sees it again.
// 3. Trip start: first_underway_at from GtfsTripOperationalEvidence, written by
//    the VehiclePosition poller only after the vehicle progresses beyond the
//    trip's first stop. TripUpdate presence is deliberately not start evidence:
//    prediction feeds list trips hours before they begin.
//
// Silent no-shows are checked for "today" and "yesterday": GTFS times exceed
// 24:00:00 for a trip that runs past midnight, and a 30-minute deadline can
// itself fall after midnight, so a trip's deadline may pass only once the
// calendar day has rolled over.
//
// Every read is injected through GtfsDetectionDeps, defaulting to LIVE, so the
// detection rules - which trips are past their deadline, which day they belong
// to, which are excluded, and what the day's own evidence can support - are a
// pure function of one Scheduled day (CONTEXT.md) and can be tested without a
// database. See gtfs.test.ts.
import { sql, getPool } from "../../db";
import { mapCanceledTrip, type CanceledTrip, type GtfsRtTripUpdateEntity } from "../../gtfsTripUpdates";
import { agencyServiceDate, serviceDateAndGtfsSecondsToUtc } from "../../missedTripTime";
import { activeServiceIdsToday } from "../../gtfsScheduleHorizon";
import { underwayEvidenceCoverage, type KpiFeedHealth } from "../../kpiTrust";
import { loadKpiFeedHealthRecords } from "../../kpiTrustStore";
import type { FeedRunLog } from "../../feedRun";
import {
  blockContinuity,
  noShowDecision,
  scheduleAgreement,
  staticScheduleConfidence,
  type BlockTripEvidence,
  type ScheduleConfidence,
} from "../../missedTripConfidence";
import { WINDOWED_DETECTOR_VERSION } from "../classify";
import { missedTripDetectionSettings, type MissedTripDetectionSettings } from "../settings";
import type { RunObservation, RunRef } from "../types";

export const GTFS_CANCEL_DETECTOR = "gtfs-cancel-v1";
// v4: cases carry their Expected operating window (migration 125).
export const GTFS_SILENT_DETECTOR = WINDOWED_DETECTOR_VERSION;

const GRACE_SECONDS = 30 * 60;

// One scheduled run as the detector reads it, with the operational evidence
// and route classification that apply to it on this service date.
export interface ScheduledRun {
  trip_id: string;
  route_id: string;
  block_id: string | null;
  first_departure_seconds: number;
  last_arrival_seconds: number | null;
  first_underway_at: Date | null;
  first_vehicle_position_at: Date | null;
  first_trip_update_at: Date | null;
  special_event: boolean;
}

// A Scheduled day (CONTEXT.md): what one pass read about the runs expected on
// one local service date. Not a Schedule snapshot - nothing here is retained.
export interface ScheduledDay {
  serviceDate: string;
  runs: ScheduledRun[];
}

// One agency service date and its weekday, as agencyServiceDate returns them.
export type AgencyDay = ReturnType<typeof agencyServiceDate>;

// Positive start evidence for one trip on one service date.
export interface TripStartEvidence {
  trip_id: string;
  service_date: string;
  first_underway_at: Date;
  route_id: string | null;
  first_departure_seconds: number | null;
}

// Injected so the detection rules can be tested without a database.
export interface GtfsDetectionDeps {
  /** The day's scheduled runs; empty when no service id is active. */
  scheduledDay: (day: AgencyDay) => Promise<ScheduledDay>;
  /** Every trip with start evidence on these service dates. */
  tripStarts: (serviceDates: string[]) => Promise<TripStartEvidence[]>;
  /**
   * Scheduled first-departure seconds for these trip ids, by trip id.
   *
   * KNOWN DIVERGENCE, preserved deliberately: this reads by trip id alone,
   * with no service filter, while scheduledDay filters by the service ids
   * active on the date. The two therefore draw from different populations, so
   * a cancellation can resolve its start time from a service pattern that is
   * not running that day. Carried over unchanged rather than fixed, because
   * the silent no-show detector is mid-Shadow detection and its precision
   * figure has to be measured against unchanged detection.
   */
  departureSecondsFor: (tripIds: string[]) => Promise<Map<string, number>>;
  feedHealth: () => Promise<KpiFeedHealth[]>;
}

const LIVE: GtfsDetectionDeps = {
  scheduledDay: async ({ serviceDate, dow }) => {
    const pool = await getPool();
    const serviceIds = await activeServiceIdsToday(pool, serviceDate, dow);
    if (serviceIds.length === 0) return { serviceDate, runs: [] };
    const req = pool.request();
    req.input("service_date", sql.NVarChar, serviceDate);
    serviceIds.forEach((id, i) => req.input(`sid${i}`, sql.NVarChar, id));
    // The whole day's scheduled trips, not only the undecided ones: the
    // schedule-agreement guard divides by the day's population, and filtering
    // first would measure only the trips that make a bad schedule look broken.
    //
    // SpecialEvent (migration 016): a base-schedule trip on a route overridden for
    // a special event may legitimately not run, though still in the static import.
    const scheduled = await req.query<ScheduledRun>(`
      SELECT st.trip_id, st.route_id, st.block_id, st.first_departure_seconds, st.last_arrival_seconds,
             evidence.first_underway_at, evidence.first_vehicle_position_at, evidence.first_trip_update_at,
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
      WHERE st.service_id IN (${serviceIds.map((_, i) => `@sid${i}`).join(", ")})
    `);
    return { serviceDate, runs: scheduled.recordset };
  },

  tripStarts: async (serviceDates) => {
    const pool = await getPool();
    const request = pool.request();
    serviceDates.forEach((date, i) => request.input(`date${i}`, sql.NVarChar(20), date));
    const result = await request.query<TripStartEvidence>(`
      SELECT e.trip_id, e.service_date, e.first_underway_at, st.route_id, st.first_departure_seconds
      FROM GtfsTripOperationalEvidence e
      LEFT JOIN GtfsScheduledTrips st ON st.trip_id = e.trip_id
      WHERE e.service_date IN (${serviceDates.map((_, i) => `@date${i}`).join(", ")}) AND e.first_underway_at IS NOT NULL`);
    return result.recordset;
  },

  departureSecondsFor: async (tripIds) => {
    const pool = await getPool();
    const starts = await pool.request()
      .input("trip_ids", sql.NVarChar(sql.MAX), JSON.stringify(tripIds))
      .query<{ trip_id: string; first_departure_seconds: number }>(`
        SELECT st.trip_id, st.first_departure_seconds
        FROM OPENJSON(@trip_ids) WITH (trip_id NVARCHAR(100) '$') ids
        JOIN GtfsScheduledTrips st ON st.trip_id = ids.trip_id`);
    return new Map(starts.recordset.map((r) => [r.trip_id, r.first_departure_seconds]));
  },

  feedHealth: async () => loadKpiFeedHealthRecords(await getPool()),
};

export interface GtfsObservationTally {
  cancellations: number;
  undatedCancellations: number;
  noShows: number;
  undecidable: number;
  tripStarts: number;
  undecidedBy: Map<string, number>;
  warnings: string[];
}

export function emptyTally(): GtfsObservationTally {
  return { cancellations: 0, undatedCancellations: 0, noShows: 0, undecidable: 0, tripStarts: 0, undecidedBy: new Map(), warnings: [] };
}

export interface DetectionConfidence {
  coverageProven: boolean;
  coverageReason: string;
  staticSchedule: ScheduleConfidence;
}

// Resolved against the shared fixed_route_missed_trips contract rather than a
// local freshness rule, and failing closed: an unreadable ledger counts as
// unproven coverage.
async function resolveDetectionConfidence(deps: GtfsDetectionDeps, log: FeedRunLog): Promise<DetectionConfidence> {
  try {
    const health = await deps.feedHealth();
    const positions = underwayEvidenceCoverage(health);
    const coverageProven = positions.state === "current";
    return {
      coverageProven,
      coverageReason: coverageProven ? "" : `gtfs_vehicle_positions is ${positions.state}` +
        (positions.last_success_at ? ` (last success ${positions.last_success_at})` : " (no successful ingestion recorded)"),
      staticSchedule: staticScheduleConfidence(health),
    };
  } catch (err) {
    log.error("Failed to resolve feed confidence for silent no-show detection:", err);
    return {
      coverageProven: false,
      coverageReason: "vehicle-position feed health could not be read",
      staticSchedule: { trusted: false, explanation: "static GTFS feed health could not be read" },
    };
  }
}

function withDeadline(scheduledStartAt: Date): Pick<RunRef, "scheduledStartAt" | "deadlineAt"> {
  return { scheduledStartAt, deadlineAt: new Date(scheduledStartAt.getTime() + GRACE_SECONDS * 1000) };
}

// ---------------------------------------------------------------------------
// The detection rules. Pure: every one of these takes what a read returned.
// ---------------------------------------------------------------------------

export function cancellationObservations(
  dated: readonly CanceledTrip[],
  secondsByTrip: ReadonlyMap<string, number>,
  now: Date,
  tally: GtfsObservationTally,
): RunObservation[] {
  return dated.map((trip) => {
    const seconds = secondsByTrip.get(trip.trip_id);
    const scheduled = seconds === undefined ? null : serviceDateAndGtfsSecondsToUtc(trip.service_date!, seconds);
    tally.cancellations++;
    return {
      run: {
        source: "gtfs" as const,
        runId: trip.trip_id,
        serviceDate: trip.service_date!,
        routeId: trip.route_id,
        // Without a scheduled start the detection time stands in for both, as it
        // always has; the case still records the cancellation.
        ...(scheduled ? withDeadline(scheduled) : { scheduledStartAt: now, deadlineAt: now }),
      },
      detectorVersion: GTFS_CANCEL_DETECTOR,
      fact: { kind: "cancellation" as const },
    };
  });
}

// The cancelled trips in the feed that carry a service date. Counts the ones
// that do not, which cannot be placed on a service day and are not recorded.
export function datedCancellations(entities: readonly GtfsRtTripUpdateEntity[], tally: GtfsObservationTally): CanceledTrip[] {
  const canceled = entities.map(mapCanceledTrip).filter((t): t is CanceledTrip => t !== null);
  const dated = canceled.filter((t) => t.service_date);
  tally.undatedCancellations += canceled.length - dated.length;
  return dated;
}

// What the day itself can support: agreement over the trips whose deadline has
// passed, and each block's trips for blockContinuity. Measured over the whole
// day, special-event routes included - the denominator is the day's population.
export function dayEvidence(day: ScheduledDay, now: Date): { agreement: ScheduleConfidence; blocks: Map<string, BlockTripEvidence[]> } {
  let deadlinePassed = 0;
  let knownToFeed = 0;
  const blocks = new Map<string, BlockTripEvidence[]>();
  for (const trip of day.runs) {
    if (trip.block_id) {
      const blockTrips = blocks.get(trip.block_id) ?? [];
      blockTrips.push({
        departureSeconds: trip.first_departure_seconds,
        operated: trip.first_underway_at !== null,
        reportedPosition: trip.first_vehicle_position_at !== null,
      });
      blocks.set(trip.block_id, blockTrips);
    }
    const start = serviceDateAndGtfsSecondsToUtc(day.serviceDate, trip.first_departure_seconds);
    if (!start || withDeadline(start).deadlineAt.getTime() > now.getTime()) continue;
    deadlinePassed++;
    if (trip.first_trip_update_at !== null || trip.first_vehicle_position_at !== null) knownToFeed++;
  }
  return { agreement: scheduleAgreement({ deadlinePassed, knownToFeed }), blocks };
}

export function silentNoShowObservations(
  day: ScheduledDay,
  confidence: DetectionConfidence,
  now: Date,
  tally: GtfsObservationTally,
): RunObservation[] {
  if (day.runs.length === 0) return [];
  const { agreement, blocks } = dayEvidence(day, now);

  const observations: RunObservation[] = [];
  for (const trip of day.runs) {
    if (trip.special_event) continue;
    const start = serviceDateAndGtfsSecondsToUtc(day.serviceDate, trip.first_departure_seconds);
    if (!start) continue;
    const times = withDeadline(start);
    if (times.deadlineAt.getTime() > now.getTime()) continue;
    if (trip.first_underway_at && trip.first_underway_at.getTime() <= times.deadlineAt.getTime()) continue;

    const blockTrips = trip.block_id ? blocks.get(trip.block_id) : undefined;
    const decision = noShowDecision({
      vehiclePositionsCurrent: confidence.coverageProven,
      staticSchedule: confidence.staticSchedule,
      agreement,
      block: blockTrips ? blockContinuity(blockTrips, trip.first_departure_seconds) : null,
    });
    const finalStop = trip.last_arrival_seconds === null ? null : serviceDateAndGtfsSecondsToUtc(day.serviceDate, trip.last_arrival_seconds);
    const operatingWindowEndAt = finalStop ? new Date(finalStop.getTime() + GRACE_SECONDS * 1000) : null;
    const run: RunRef = { source: "gtfs", runId: trip.trip_id, serviceDate: day.serviceDate, routeId: trip.route_id, ...times, operatingWindowEndAt };
    if (decision.outcome === "pending") {
      tally.noShows++;
      observations.push({ run, detectorVersion: GTFS_SILENT_DETECTOR, fact: { kind: "no_start_by_deadline" } });
    } else {
      tally.undecidable++;
      tally.undecidedBy.set(decision.reason, (tally.undecidedBy.get(decision.reason) ?? 0) + 1);
      observations.push({ run, detectorVersion: GTFS_SILENT_DETECTOR, fact: { kind: "undecidable", reason: decision.reason } });
    }
  }
  if (tally.undecidedBy.size > 0) {
    tally.warnings.push(
      (confidence.coverageProven ? "" : `Position coverage: ${confidence.coverageReason}. `) +
      (confidence.staticSchedule.explanation ? `Schedule: ${confidence.staticSchedule.explanation}. ` : "") +
      (agreement.explanation ? `Agreement for ${day.serviceDate}: ${agreement.explanation}.` : ""),
    );
  }
  return observations;
}

// The module ignores runs without a case, so start evidence needs only a
// well-formed run reference.
export function tripStartObservations(rows: readonly TripStartEvidence[], tally: GtfsObservationTally): RunObservation[] {
  return rows.map((row) => {
    const start = row.first_departure_seconds === null ? null : serviceDateAndGtfsSecondsToUtc(row.service_date, row.first_departure_seconds);
    tally.tripStarts++;
    return {
      run: {
        source: "gtfs" as const,
        runId: row.trip_id,
        serviceDate: row.service_date,
        routeId: row.route_id ?? "",
        // Start evidence never opens a case, so these only need to be well-formed.
        ...(start ? withDeadline(start) : { scheduledStartAt: row.first_underway_at, deadlineAt: row.first_underway_at }),
      },
      detectorVersion: GTFS_SILENT_DETECTOR,
      fact: { kind: "trip_start" as const, at: row.first_underway_at },
    };
  });
}

// The service dates a pass detects over: today, and yesterday - a trip that
// runs past midnight, or whose 30-minute deadline falls after it, only becomes
// past-deadline once the calendar day has rolled over.
const DETECTED_DAY_OFFSETS = [0, -1] as const;

export async function gtfsObservations(
  entities: readonly GtfsRtTripUpdateEntity[],
  log: FeedRunLog,
  settings: MissedTripDetectionSettings = missedTripDetectionSettings(),
  deps: GtfsDetectionDeps = LIVE,
  now = new Date(),
): Promise<{ observations: RunObservation[]; tally: GtfsObservationTally }> {
  const tally = emptyTally();
  const observations: RunObservation[] = [];

  const cancelled = datedCancellations(entities, tally);
  if (cancelled.length > 0) {
    const secondsByTrip = await deps.departureSecondsFor([...new Set(cancelled.map((t) => t.trip_id))]);
    observations.push(...cancellationObservations(cancelled, secondsByTrip, now, tally));
  }

  const detectedDays = DETECTED_DAY_OFFSETS.map((offset) => agencyServiceDate(now, offset));

  if (settings.silentNoShowEnabled) {
    const confidence = await resolveDetectionConfidence(deps, log);
    for (const day of detectedDays) {
      try {
        observations.push(...silentNoShowObservations(await deps.scheduledDay(day), confidence, now, tally));
      } catch (err) {
        log.error(`Failed to run silent no-show detection (${day.serviceDate}):`, err);
      }
    }
  }

  observations.push(...tripStartObservations(await deps.tripStarts(detectedDays.map((day) => day.serviceDate)), tally));

  return { observations, tally };
}
