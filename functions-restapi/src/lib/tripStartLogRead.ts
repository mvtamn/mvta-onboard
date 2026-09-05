// One service date of the Dispatch Log, read the same way for JSON and CSV
// (plans/dispatch-log-spec.md §4.2): one row per revenue trip, joined to the
// human verification if one exists. Both GET /trip-start-log and its export
// come through here so the two can never disagree about a day.
import { sql } from "./db";
import type { TripStartActualSource, TripStartStatus } from "./tripStartTypes";

export interface TripStartLogRow {
  service_date: string;
  trip_id: string;
  block_id: string | null;
  route_id: string;
  route_short_name: string | null;
  direction_id: number | null;
  direction_label: string | null;
  origin_stop_id: string | null;
  origin_stop_name: string | null;
  scheduled_start_seconds: number;
  scheduled_start_at: Date;
  in_rotation: boolean;
  rotation_day: string | null;
  actual_start_at: Date | null;
  actual_start_source: string | null;
  start_delay_seconds: number | null;
  start_status: string | null;
  predicted_start_at: Date | null;
  materialized_at: Date;
  updated_at: Date;
  observation: string | null;
  verified_by: string | null;
  verified_initials: string | null;
  verified_at: Date | null;
  note: string | null;
}

export interface TripStartLogTrip {
  service_date: string;
  trip_id: string;
  block_id: string | null;
  route_id: string;
  route_short_name: string | null;
  direction_id: number | null;
  direction_label: string | null;
  origin_stop_id: string | null;
  origin_stop_name: string | null;
  scheduled_start_seconds: number;
  scheduled_start_at: string;
  in_rotation: boolean;
  rotation_day: string | null;
  actual_start_at: string | null;
  actual_start_source: TripStartActualSource | null;
  start_delay_seconds: number | null;
  start_status: TripStartStatus;
  /** The feed's last first-stop departure prediction, until an actual exists. */
  predicted_start_at: string | null;
  verification: {
    observation: string;
    verified_by: string;
    verified_initials: string;
    verified_at: string;
    note: string | null;
  } | null;
}

export function shapeTrip(row: TripStartLogRow): TripStartLogTrip {
  return {
    service_date: row.service_date,
    trip_id: row.trip_id,
    block_id: row.block_id,
    route_id: row.route_id,
    route_short_name: row.route_short_name,
    direction_id: row.direction_id,
    direction_label: row.direction_label,
    origin_stop_id: row.origin_stop_id,
    origin_stop_name: row.origin_stop_name,
    scheduled_start_seconds: row.scheduled_start_seconds,
    scheduled_start_at: row.scheduled_start_at.toISOString(),
    in_rotation: Boolean(row.in_rotation),
    rotation_day: row.rotation_day,
    actual_start_at: row.actual_start_at?.toISOString() ?? null,
    actual_start_source: (row.actual_start_source as TripStartActualSource | null) ?? null,
    // A trip with no realtime evidence is unknown, never on time (spec §6).
    start_delay_seconds: row.start_delay_seconds,
    start_status: (row.start_status as TripStartStatus | null) ?? "unknown",
    predicted_start_at: row.predicted_start_at?.toISOString() ?? null,
    verification:
      row.observation && row.verified_by && row.verified_initials && row.verified_at
        ? {
            observation: row.observation,
            verified_by: row.verified_by,
            verified_initials: row.verified_initials,
            verified_at: row.verified_at.toISOString(),
            note: row.note,
          }
        : null,
  };
}

export async function tripStartLogTablesReady(pool: sql.ConnectionPool): Promise<boolean> {
  const check = await pool.request().query<{ ok: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.TripStartLog', 'U') IS NOT NULL
                 AND OBJECT_ID('dbo.TripStartVerifications', 'U') IS NOT NULL
      THEN 1 ELSE 0 END AS ok
  `);
  return check.recordset[0]?.ok === 1;
}

/** The day's trips in the workbook's order: scheduled start ascending, then trip id. */
export async function loadTripStartLogDay(pool: sql.ConnectionPool, serviceDate: string): Promise<TripStartLogTrip[]> {
  const req = pool.request();
  req.input("service_date", sql.Char(8), serviceDate);
  const result = await req.query<TripStartLogRow>(`
    SELECT l.service_date, l.trip_id, l.block_id, l.route_id, l.route_short_name,
           l.direction_id, l.direction_label, l.origin_stop_id, l.origin_stop_name,
           l.scheduled_start_seconds, l.scheduled_start_at, l.in_rotation, l.rotation_day,
           l.actual_start_at, l.actual_start_source, l.start_delay_seconds, l.start_status,
           l.materialized_at, l.updated_at,
           CASE WHEN COL_LENGTH('dbo.TripStartLog', 'predicted_start_at') IS NULL THEN NULL ELSE l.predicted_start_at END AS predicted_start_at,
           v.observation, v.verified_by, v.verified_initials, v.verified_at, v.note
    FROM TripStartLog l
    LEFT JOIN TripStartVerifications v
      ON v.service_date = l.service_date AND v.trip_id = l.trip_id
    WHERE l.service_date = @service_date
    ORDER BY l.scheduled_start_seconds, l.trip_id
  `);
  return result.recordset.map(shapeTrip);
}
