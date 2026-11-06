// Avail source adapter for the Missed-trip case module: turns the vendor's own
// retrospective Missed Trips By Route/Stop/Day report into observations about
// cases that already exist. ADR-0035.
//
// Avail names no trip. A record carries a route, a calendar date, its departure
// and arrival stops, and a departure trip start time. That start time is the
// minute the bus actually LEFT, not the published start (measured on dev
// 2026-11-06: 90% of the records 1-5 minutes off a scheduled start sat within a
// minute of the Dispatch Log's actual start; ADR-0047). So a record is placed
// in two steps:
//
//   1. Resolve it to a trip. Among every trip on that route and service date
//      (TripStartLog), find the one whose departure fell in Avail's minute -
//      its actual start where the Dispatch Log has one, its scheduled start
//      where it has none.
//   2. Look for a case on that trip.
//
//   exact      - exactly one trip left that minute, and it has a case.
//   probable   - the start time is absent, or more than one trip left that
//                minute.
//   unmatched  - no trip left that minute, or the one that did has no case.
//
// Resolving against cases alone would hand a record to whichever case was
// scheduled that minute, even when that case's bus left late and a different
// trip left on the minute. A route-day the Dispatch Log does not cover (it
// starts 2026-08-31) keeps the original rule: a case scheduled that minute.
// A probable link is reported and counted but produces no observation: it
// changes nothing until a reviewer confirms it.
//
// This adapter never opens a case. Avail is the strongest evidence available
// for a finished run, which is exactly why it is not allowed to raise a finding
// unreviewed - a detector that creates cases enters Shadow detection.
import { getPool, sql } from "../../db";
import type { EvidenceMatchConfidence, RunObservation } from "../types";

export const AVAIL_DETECTOR = "avail-retrospective-v1";

// Avail restates the trailing three months on every daily run, so the window
// read here is the window that can still change.
export const DEFAULT_LOOKBACK_DAYS = 95;

/** One Avail missed-trip record, as the adapter reads it. */
export interface AvailMissedTripRow {
  calendar_date: string;
  route_id: number;
  departure_stop_name: string | null;
  arrival_stop_name: string | null;
  departure_missed: boolean;
  arrival_missed: boolean;
  entire_trip_missed: boolean;
  departure_trip_start_time: Date | null;
}

/** One open or concluded case an Avail record could be speaking about. */
export interface MatchableCase {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_departure_at: Date;
}

/** A trip scheduled on a route and day, and when the Dispatch Log saw it leave. */
export interface ScheduledTrip {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_start_at: Date;
  actual_start_at: Date | null;
}

export interface AvailMatchTally {
  reports: number;
  exact: number;
  probable: number;
  unmatched: number;
  conflicts: number;
}

export function emptyAvailTally(): AvailMatchTally {
  return { reports: 0, exact: 0, probable: 0, unmatched: 0, conflicts: 0 };
}

// Minute precision on both sides: the second is noise from two systems
// formatting the same scheduled time.
function toMinute(value: Date): number {
  return Math.floor(value.getTime() / 60_000);
}

function caseKeyOf(row: { route_id: string; service_date: string }): string {
  return `${row.service_date}|${row.route_id}`;
}

export interface AvailMatch {
  confidence: EvidenceMatchConfidence;
  /** The single case an exact link names; null for probable and unmatched. */
  matched: MatchableCase | null;
  /** How many cases (or, resolved by trip, trips) the record could have been speaking about. */
  candidates: number;
  /**
   * The trip the record was resolved to: a trip id, null when no single trip
   * left that minute, and absent when the route-day had no trips to resolve
   * against and the match was made on cases alone.
   */
  trip_id?: string | null;
}

// A reading this far from the schedule is the log's fault, not the bus's:
// across every dev reading to 2026-11-06 one departure ran 30-60 minutes late
// and none later, while all 605 readings for 2026-09-09 sat a day late.
const EARLIEST_PLAUSIBLE_MS = -30 * 60_000;
const LATEST_PLAUSIBLE_MS = 3 * 60 * 60_000;

// When the trip left, as far as anything recorded: the Dispatch Log's actual
// start when it is plausible, else the published one.
export function departedAt(trip: ScheduledTrip): Date {
  if (!trip.actual_start_at) return trip.scheduled_start_at;
  const late = trip.actual_start_at.getTime() - trip.scheduled_start_at.getTime();
  return late >= EARLIEST_PLAUSIBLE_MS && late <= LATEST_PLAUSIBLE_MS ? trip.actual_start_at : trip.scheduled_start_at;
}

// Avail's route ids are integers; a case carries the GTFS route id as a string.
export function matchAvailReport(
  row: AvailMissedTripRow,
  byRouteDay: ReadonlyMap<string, MatchableCase[]>,
  tripsByRouteDay: ReadonlyMap<string, ScheduledTrip[]> = new Map(),
): AvailMatch {
  const key = `${row.calendar_date}|${row.route_id}`;
  const trips = tripsByRouteDay.get(key) ?? [];
  if (trips.length > 0 && row.departure_trip_start_time) {
    const minute = toMinute(row.departure_trip_start_time);
    const left = trips.filter((t) => toMinute(departedAt(t)) === minute);
    if (left.length > 1) return { confidence: "probable", matched: null, candidates: left.length, trip_id: null };
    if (left.length === 0) return { confidence: "unmatched", matched: null, candidates: trips.length, trip_id: null };
    const trip = left[0];
    const theCase = (byRouteDay.get(key) ?? []).find((c) => c.trip_id === trip.trip_id && c.service_date === trip.service_date);
    return theCase
      ? { confidence: "exact", matched: theCase, candidates: 1, trip_id: trip.trip_id }
      : { confidence: "unmatched", matched: null, candidates: 0, trip_id: trip.trip_id };
  }
  const candidates = byRouteDay.get(key) ?? [];
  if (candidates.length === 0) return { confidence: "unmatched", matched: null, candidates: 0 };
  if (!row.departure_trip_start_time) {
    // Route and date alone. On a frequent route that is several cases, and even
    // when it is one, nothing ties this record to it.
    return { confidence: "probable", matched: null, candidates: candidates.length };
  }
  const minute = toMinute(row.departure_trip_start_time);
  const onTheMinute = candidates.filter((c) => toMinute(c.scheduled_departure_at) === minute);
  if (onTheMinute.length === 1) return { confidence: "exact", matched: onTheMinute[0], candidates: 1 };
  if (onTheMinute.length > 1) return { confidence: "probable", matched: null, candidates: onTheMinute.length };
  return { confidence: "unmatched", matched: null, candidates: candidates.length };
}

// What Avail says happened, in the module's vocabulary. A trip missed in whole
// corroborates a missed trip; a trip that ran while missing a scheduled stop is
// a Partial-service failure, which is already one of the four review outcomes.
export function availObservation(row: AvailMissedTripRow, matched: MatchableCase): RunObservation | null {
  const run = {
    source: "avail" as const,
    runId: matched.trip_id,
    serviceDate: matched.service_date,
    routeId: matched.route_id,
    scheduledStartAt: matched.scheduled_departure_at,
    // Avail is retrospective; the deadline is the case's own and is not
    // re-derived here. The module ignores it for a source that opens nothing.
    deadlineAt: matched.scheduled_departure_at,
  };
  const evidence = {
    source: "avail",
    calendarDate: row.calendar_date,
    routeId: row.route_id,
    departureStopName: row.departure_stop_name,
    arrivalStopName: row.arrival_stop_name,
    departureMissed: row.departure_missed,
    arrivalMissed: row.arrival_missed,
    entireTripMissed: row.entire_trip_missed,
    departureTripStartTime: row.departure_trip_start_time,
    matchConfidence: "exact" as const,
  };
  if (row.entire_trip_missed) {
    return { run, detectorVersion: AVAIL_DETECTOR, fact: { kind: "retrospective_missed" }, evidence };
  }
  if (row.departure_missed || row.arrival_missed) {
    return {
      run,
      detectorVersion: AVAIL_DETECTOR,
      fact: { kind: "retrospective_partial", missedDeparture: row.departure_missed, missedArrival: row.arrival_missed },
      evidence,
    };
  }
  // A record that reports nothing missed says nothing about the case.
  return null;
}

// Injected so the matching rule can be tested without a database, the way
// gtfsRtReader and the GTFS adapter take their reads.
export interface AvailDetectionDeps {
  /** Avail records in the window that can still change. */
  reports: (sinceDays: number) => Promise<AvailMissedTripRow[]>;
  /** Cases those records could be speaking about, by service date and route. */
  casesInWindow: (serviceDates: readonly string[]) => Promise<MatchableCase[]>;
  /** Every fixed-route trip on those dates, with the Dispatch Log's actual start. */
  tripsInWindow: (serviceDates: readonly string[]) => Promise<ScheduledTrip[]>;
}

const LIVE: AvailDetectionDeps = {
  reports: async (sinceDays) => {
    const pool = await getPool();
    const result = await pool.request()
      .input("since", sql.Int, sinceDays)
      .query<AvailMissedTripRow>(`
        SELECT calendar_date, route_id, departure_stop_name, arrival_stop_name,
               departure_missed, arrival_missed, entire_trip_missed, departure_trip_start_time
        FROM AvailMissedTripsRouteStopDay
        WHERE calendar_date >= CONVERT(CHAR(8), DATEADD(DAY, -@since, SYSUTCDATETIME()), 112)
          AND (departure_missed = 1 OR arrival_missed = 1 OR entire_trip_missed = 1)`);
    return result.recordset;
  },
  casesInWindow: async (serviceDates) => {
    if (serviceDates.length === 0) return [];
    const pool = await getPool();
    const result = await pool.request()
      .input("dates", sql.NVarChar(sql.MAX), JSON.stringify(serviceDates))
      .query<MatchableCase>(`
        SELECT m.trip_id, m.service_date, m.route_id, m.scheduled_departure_at
        FROM OPENJSON(@dates) WITH (d NVARCHAR(20) '$') k
        JOIN MonitoredMissedTrips m ON m.service_date = k.d
        -- Avail reports fixed route only; a Spare case's route is a service
        -- name and could never match an Avail route id anyway, but saying so
        -- keeps the candidate set honest.
        WHERE ISNULL(m.source_system, N'gtfs') <> N'spare'`);
    return result.recordset;
  },
  tripsInWindow: async (serviceDates) => {
    if (serviceDates.length === 0) return [];
    const pool = await getPool();
    const result = await pool.request()
      .input("dates", sql.NVarChar(sql.MAX), JSON.stringify(serviceDates))
      .query<ScheduledTrip>(`
        SELECT t.trip_id, t.service_date, t.route_id, t.scheduled_start_at, t.actual_start_at
        FROM OPENJSON(@dates) WITH (d NVARCHAR(20) '$') k
        JOIN TripStartLog t ON t.service_date = k.d`);
    return result.recordset;
  },
};

export function availMissedTripsReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AVAIL_MISSED_TRIPS_URL?.trim() && env.AVAIL_AVL_REPORTS_API_KEY?.trim());
}

/** One record and how it was placed, for whoever needs to keep the link. */
export interface MatchedAvailReport {
  row: AvailMissedTripRow;
  match: AvailMatch;
}

export async function availObservations(
  deps: AvailDetectionDeps = LIVE,
  sinceDays = DEFAULT_LOOKBACK_DAYS,
): Promise<{ observations: RunObservation[]; tally: AvailMatchTally; matches: MatchedAvailReport[] }> {
  const tally = emptyAvailTally();
  const reports = await deps.reports(sinceDays);
  tally.reports = reports.length;
  if (reports.length === 0) return { observations: [], tally, matches: [] };

  const serviceDates = [...new Set(reports.map((r) => r.calendar_date))];
  const byRouteDay = new Map<string, MatchableCase[]>();
  for (const row of await deps.casesInWindow(serviceDates)) {
    const key = caseKeyOf(row);
    const list = byRouteDay.get(key) ?? [];
    list.push(row);
    byRouteDay.set(key, list);
  }
  // Only a record with a start time can be resolved to a trip.
  const timedDates = [...new Set(reports.filter((r) => r.departure_trip_start_time).map((r) => r.calendar_date))];
  const tripsByRouteDay = new Map<string, ScheduledTrip[]>();
  for (const trip of await deps.tripsInWindow(timedDates)) {
    const key = caseKeyOf({ route_id: trip.route_id, service_date: trip.service_date });
    const list = tripsByRouteDay.get(key) ?? [];
    list.push(trip);
    tripsByRouteDay.set(key, list);
  }

  const observations: RunObservation[] = [];
  const matches: MatchedAvailReport[] = [];
  for (const row of reports) {
    const match = matchAvailReport(row, byRouteDay, tripsByRouteDay);
    matches.push({ row, match });
    if (match.confidence === "exact" && match.matched) {
      tally.exact++;
      const observation = availObservation(row, match.matched);
      if (observation) observations.push(observation);
    } else if (match.confidence === "probable") {
      tally.probable++;
    } else {
      tally.unmatched++;
    }
  }
  return { observations, tally, matches };
}
