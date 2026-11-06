// Avail OTP Daily as contradicting evidence for fixed-route Missed-trip cases
// (ADR-0046; option d of docs/research/avail-vs-gtfs-rt-missed-trip-detection-2026-11-04.md).
//
// OTP Daily counts departures per route x stop x local hour. At a case's origin
// stop (the Dispatch Log's origin_stop_id, which is Avail's stop_id), in the
// Central calendar date and hour of its Published Trip start, on its route:
// when Avail called none of that hour's departures missed, and saw at least as
// many as trips were scheduled to start there, every one of those trips left,
// this run among them. That is a Departure observed at origin. Both halves are
// needed: OTP Daily counts every departure of the route from the stop, trips
// that only pass through it included, so the count alone can exceed the trips
// that start there while one of them stayed put. It is hour-level, so it never closes a case the way a
// Trip start does; it is kept on the case and contradicts one that says the
// run never started.
//
// Two things say nothing:
//   - a shortfall, or any departure Avail called missed: an hour-level count
//     cannot say which trip did not leave;
//   - no OTP row at all: Avail never detects departures at some origins
//     (Burnsville Center, 776 of 776 origin-hours in October), so its silence
//     there is not evidence.
//
// Like the missed-trips report this adapter never opens a case (ADR-0035).
import { getPool, sql } from "../../db";
import type { RunObservation } from "../types";
import { DEFAULT_LOOKBACK_DAYS } from "./avail";

export const AVAIL_OTP_ORIGIN_DETECTOR = "avail-otp-origin-v1";

/** One fixed-route case and what OTP Daily says about its origin hour. */
export interface OriginHourRow {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_departure_at: Date;
  origin_stop_id: string;
  origin_stop_name: string | null;
  /** The Published Trip start's hour of day in Central time, 0-23. */
  local_hour: number;
  /** Trips scheduled on this route from this origin in this local hour. */
  scheduled: number;
  /** OTP Daily departures there; null when Avail has no row for that hour. */
  departures: number | null;
  /** Departures Avail expected there and did not see; null with departures. */
  missed: number | null;
}

export interface OriginDepartureTally {
  cases: number;
  departed: number;
  short: number;
  noRow: number;
}

export interface OriginDepartureDeps {
  originHours: (sinceDays: number) => Promise<OriginHourRow[]>;
}

// The date and hour are taken from TripStartLog's UTC schedule, converted with
// SQL Server's Windows zone (DST-aware). OTP Daily files a departure under its
// local calendar date and hour, so a trip after midnight is looked up on the
// next calendar day, not its service date.
const LIVE: OriginDepartureDeps = {
  originHours: async (sinceDays) => {
    const pool = await getPool();
    const ready = await pool.request().query<{ ok: number }>(`
      SELECT CASE WHEN OBJECT_ID('dbo.TripStartLog', 'U') IS NOT NULL
                   AND OBJECT_ID('dbo.OtpDailyRouteStopHour', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok`);
    if (ready.recordset[0]?.ok !== 1) return [];
    const result = await pool.request()
      .input("since", sql.Int, sinceDays)
      .query<OriginHourRow>(originHoursSql());
    return result.recordset;
  },
};

export function originHoursSql(): string {
  return `
    WITH c AS (
      SELECT m.trip_id, m.service_date, m.route_id, m.scheduled_departure_at,
             dl.origin_stop_id, dl.origin_stop_name,
             CAST(DATEPART(HOUR, lt.local_at) AS INT) AS local_hour,
             CONVERT(CHAR(8), CAST(lt.local_at AS DATE), 112) AS local_date
      FROM MonitoredMissedTrips m
      JOIN TripStartLog dl ON dl.trip_id = m.trip_id AND CAST(dl.service_date AS NVARCHAR(20)) = m.service_date
      CROSS APPLY (SELECT CAST(dl.scheduled_start_at AS DATETIMEOFFSET) AT TIME ZONE 'Central Standard Time' AS local_at) lt
      WHERE ISNULL(m.source_system, N'gtfs') = N'gtfs'
        AND m.data_quality_status <> N'legacy_unverified'
        AND m.service_date >= CONVERT(CHAR(8), DATEADD(DAY, -@since, SYSUTCDATETIME()), 112)
        AND dl.origin_stop_id IS NOT NULL AND dl.scheduled_start_at IS NOT NULL
    )
    SELECT c.trip_id, c.service_date, c.route_id, c.scheduled_departure_at, c.origin_stop_id, c.origin_stop_name,
           c.local_hour, s.scheduled, o.departures, o.missed
    FROM c
    CROSS APPLY (
      SELECT COUNT(*) AS scheduled
      FROM TripStartLog x
      WHERE CAST(x.service_date AS NVARCHAR(20)) = c.service_date AND x.route_id = c.route_id
        AND x.origin_stop_id = c.origin_stop_id
        AND CONVERT(CHAR(8), CAST(CAST(x.scheduled_start_at AS DATETIMEOFFSET) AT TIME ZONE 'Central Standard Time' AS DATE), 112) = c.local_date
        AND DATEPART(HOUR, CAST(x.scheduled_start_at AS DATETIMEOFFSET) AT TIME ZONE 'Central Standard Time') = c.local_hour
    ) s
    OUTER APPLY (
      SELECT SUM(ISNULL(od.actual_departures, 0)) AS departures, SUM(ISNULL(od.missed, 0)) AS missed
      FROM OtpDailyRouteStopHour od
      WHERE od.calendar_date = c.local_date AND od.route_id = TRY_CAST(c.route_id AS INT)
        AND od.stop_id = TRY_CAST(c.origin_stop_id AS INT) AND od.hour_of_day = c.local_hour
      HAVING COUNT(*) > 0
    ) o`;
}

export function originDepartureObservation(row: OriginHourRow): RunObservation | null {
  if (row.departures === null || row.scheduled <= 0 || row.departures < row.scheduled || (row.missed ?? 0) > 0) return null;
  const originStopName = row.origin_stop_name?.trim() || `stop ${row.origin_stop_id}`;
  return {
    run: {
      source: "avail",
      runId: row.trip_id,
      serviceDate: row.service_date,
      routeId: row.route_id,
      scheduledStartAt: row.scheduled_departure_at,
      // Retrospective: the case keeps its own deadline.
      deadlineAt: row.scheduled_departure_at,
    },
    detectorVersion: AVAIL_OTP_ORIGIN_DETECTOR,
    fact: { kind: "origin_departures_observed", departures: row.departures, scheduled: row.scheduled, originStopName, localHour: row.local_hour },
    // The counts as Avail gave them; Avail restates and later purges the row.
    evidence: {
      source: "avail_otp_daily",
      calendarDate: row.service_date,
      routeId: row.route_id,
      originStopId: row.origin_stop_id,
      originStopName,
      localHour: row.local_hour,
      departures: row.departures,
      scheduled: row.scheduled,
      missed: row.missed ?? 0,
    },
  };
}

export async function availOriginDepartureObservations(
  deps: OriginDepartureDeps = LIVE,
  sinceDays = DEFAULT_LOOKBACK_DAYS,
): Promise<{ observations: RunObservation[]; tally: OriginDepartureTally }> {
  const tally: OriginDepartureTally = { cases: 0, departed: 0, short: 0, noRow: 0 };
  const observations: RunObservation[] = [];
  for (const row of await deps.originHours(sinceDays)) {
    tally.cases++;
    const observation = originDepartureObservation(row);
    if (observation) {
      tally.departed++;
      observations.push(observation);
    } else if (row.departures === null) {
      tally.noRow++;
    } else {
      tally.short++;
    }
  }
  return { observations, tally };
}
