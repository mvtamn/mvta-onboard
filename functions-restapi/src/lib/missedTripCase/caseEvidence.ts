// The evidence behind a GTFS case, for the reviewer deciding it.
//
// A silent no-show is raised from absence, so the case detail used to say
// little beyond "First underway evidence: Not observed". Measured on dev
// 2026-10-21, most cases had more to go on: the Dispatch Log usually held a
// first-stop departure, the block usually had a bus reporting, and the cases
// clustered at a handful of stations where buses go quiet. This puts those
// facts on the case, each in the words the reviewer needs:
//
//   departure     the Dispatch Log's reading, and why it is not a start when
//                 it is not (schedule repeated, prediction only, no bus...)
//   started       the trip's start by operatedStartAt - the same rule the
//                 detector uses - and how late that was
//   vehicle       whether a bus reported on this trip, and when it got going
//   block         how many of the block's trips that day had a bus reporting
//   origin stop   how the other silent no-shows at this trip's first stop
//                 turned out; most of them having run marks a likely GPS
//                 dead zone
//
// Dead zones are read from OnBoard's own history rather than kept as a list:
// a list needs someone to keep it, and Avail's own stop names ("BVille Ctr")
// do not match GTFS's ("Burnsville Center"), so its missed-stop records cannot
// be joined to a trip's stop by name.
import { sql } from "../db";
import { dispatchReading, operatedSql, operatedStartAt, type DispatchReadingKind } from "./adapters/gtfs";

/** Fewest other silent no-shows at a stop before its record says anything. */
export const DEAD_ZONE_MIN_CASES = 5;
/** Share of them that ran for the stop to read as a likely dead zone. */
export const DEAD_ZONE_RAN_SHARE = 0.8;

/** One case's raw readings, as readCaseEvidence's query returns them. */
export interface CaseEvidenceRow {
  trip_id: string;
  service_date: string;
  scheduled_departure_at: Date;
  grace_deadline_at: Date;
  dispatch_start_at: Date | null;
  dispatch_start_source: string | null;
  dispatch_predicted_at: Date | null;
  dispatch_scheduled_at: Date | null;
  first_vehicle_position_at: Date | null;
  first_underway_at: Date | null;
  vehicle_id: string | null;
  block_id: string | null;
  block_trips: number | null;
  block_trips_reported: number | null;
  origin_stop_id: string | null;
  origin_stop_name: string | null;
  /** Every silent no-show at the stop, this one included. */
  origin_cases: number | null;
  origin_cases_ran: number | null;
}

/** What the console shows. Times are ISO strings. */
export interface GtfsCaseEvidence {
  departure: { reading: DispatchReadingKind; at: string | null };
  started_at: string | null;
  /** Negative when it left early; null when no start is known. */
  started_late_minutes: number | null;
  started_inside_grace: boolean | null;
  vehicle: { reported_at: string | null; underway_at: string | null; vehicle_id: string | null };
  block: { block_id: string; trips: number; trips_reported: number } | null;
  origin_stop: {
    stop_id: string;
    name: string | null;
    other_cases: number;
    other_cases_ran: number;
    likely_dead_zone: boolean;
  } | null;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function caseEvidence(r: CaseEvidenceRow): GtfsCaseEvidence {
  const reading = dispatchReading(r);
  const started = operatedStartAt(r);
  // Whole minutes, toward zero: 19 min 42 s late reads as 19, as a dispatcher
  // would say it.
  const lateMinutes = started ? Math.trunc((started.getTime() - r.scheduled_departure_at.getTime()) / 60_000) : null;

  let originStop: GtfsCaseEvidence["origin_stop"] = null;
  if (r.origin_stop_id) {
    // A case is not evidence about itself: take it off the stop's record.
    const otherCases = Math.max(0, (r.origin_cases ?? 0) - 1);
    const otherRan = Math.max(0, (r.origin_cases_ran ?? 0) - (started ? 1 : 0));
    originStop = {
      stop_id: r.origin_stop_id,
      name: r.origin_stop_name,
      other_cases: otherCases,
      other_cases_ran: otherRan,
      likely_dead_zone: otherCases >= DEAD_ZONE_MIN_CASES && otherRan / otherCases >= DEAD_ZONE_RAN_SHARE,
    };
  }

  return {
    departure: { reading: reading.kind, at: iso(reading.at) },
    started_at: iso(started),
    started_late_minutes: lateMinutes,
    started_inside_grace: started ? started.getTime() <= r.grace_deadline_at.getTime() : null,
    vehicle: { reported_at: iso(r.first_vehicle_position_at), underway_at: iso(r.first_underway_at), vehicle_id: r.vehicle_id },
    block: r.block_id ? { block_id: r.block_id, trips: r.block_trips ?? 0, trips_reported: r.block_trips_reported ?? 0 } : null,
    origin_stop: originStop,
  };
}

/** The evidence for these GTFS cases, by "trip_id|service_date". Empty without the tables it reads. */
export async function readCaseEvidence(
  pool: sql.ConnectionPool,
  cases: readonly { trip_id: string; service_date: string; scheduled_departure_at: Date; grace_deadline_at: Date }[],
): Promise<Map<string, GtfsCaseEvidence>> {
  const byKey = new Map<string, GtfsCaseEvidence>();
  if (cases.length === 0) return byKey;
  const ready = await pool.request().query<{ ok: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.TripStartLog', 'U') IS NOT NULL
                 AND OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok`);
  if (ready.recordset[0]?.ok !== 1) return byKey;

  const keys = cases.map((c) => ({ t: c.trip_id, d: c.service_date, s: c.scheduled_departure_at.toISOString(), g: c.grace_deadline_at.toISOString() }));
  // TripStartLog, not GtfsScheduledTrips, for the block and the first stop:
  // the schedule table is replaced every morning, and the log keeps each
  // day's snapshot. The stop record is counted once per stop on the page.
  const result = await pool.request()
    .input("keys", sql.NVarChar(sql.MAX), JSON.stringify(keys))
    .query<CaseEvidenceRow>(`
      WITH page AS (
        SELECT t AS trip_id, d AS service_date,
               CAST(s AS DATETIME2) AS scheduled_departure_at, CAST(g AS DATETIME2) AS grace_deadline_at
        FROM OPENJSON(@keys) WITH (t NVARCHAR(100) '$.t', d NVARCHAR(20) '$.d', s NVARCHAR(40) '$.s', g NVARCHAR(40) '$.g')
      ),
      info AS (
        SELECT p.trip_id, p.service_date, p.scheduled_departure_at, p.grace_deadline_at,
               dl.actual_start_at AS dispatch_start_at, dl.actual_start_source AS dispatch_start_source,
               dl.predicted_start_at AS dispatch_predicted_at, dl.scheduled_start_at AS dispatch_scheduled_at,
               dl.block_id, dl.origin_stop_id, dl.origin_stop_name,
               e.first_vehicle_position_at, e.first_underway_at, e.vehicle_id
        FROM page p
        LEFT JOIN TripStartLog dl ON dl.trip_id = p.trip_id AND CAST(dl.service_date AS NVARCHAR(20)) = p.service_date
        LEFT JOIN GtfsTripOperationalEvidence e ON e.trip_id = p.trip_id AND e.service_date = p.service_date
      ),
      stops AS (
        SELECT hl.origin_stop_id,
               COUNT(*) AS origin_cases,
               SUM(CASE WHEN ${operatedSql("he", "hl")} THEN 1 ELSE 0 END) AS origin_cases_ran
        FROM MonitoredMissedTrips hm
        JOIN TripStartLog hl ON hl.trip_id = hm.trip_id AND CAST(hl.service_date AS NVARCHAR(20)) = hm.service_date
        LEFT JOIN GtfsTripOperationalEvidence he ON he.trip_id = hm.trip_id AND he.service_date = hm.service_date
        WHERE hm.detection_type = N'silent_no_show'
          AND hl.origin_stop_id IN (SELECT origin_stop_id FROM info WHERE origin_stop_id IS NOT NULL)
        GROUP BY hl.origin_stop_id
      )
      SELECT i.*, blk.block_trips, blk.block_trips_reported, s.origin_cases, s.origin_cases_ran
      FROM info i
      LEFT JOIN stops s ON s.origin_stop_id = i.origin_stop_id
      OUTER APPLY (
        SELECT COUNT(*) AS block_trips,
               SUM(CASE WHEN be.first_vehicle_position_at IS NOT NULL THEN 1 ELSE 0 END) AS block_trips_reported
        FROM TripStartLog b
        LEFT JOIN GtfsTripOperationalEvidence be
          ON be.trip_id = b.trip_id AND be.service_date = CAST(b.service_date AS NVARCHAR(20))
        WHERE i.block_id IS NOT NULL AND b.block_id = i.block_id
          AND CAST(b.service_date AS NVARCHAR(20)) = i.service_date
      ) blk`);
  for (const row of result.recordset) byKey.set(`${row.trip_id}|${row.service_date}`, caseEvidence(row));
  return byKey;
}
