// Every change ever made to one trip's Verified cell (migration 096a). The
// cell itself says only where it stands now; this is the record of how it got
// there - who set what, from what, when, with what note. Append-only, so a
// correction and the entry it corrected both survive.
import { sql } from "./db";

export interface TripStartVerificationEventRow {
  previous_observation: string | null;
  observation: string | null;
  recorded_by: string;
  recorded_initials: string;
  note: string | null;
  recorded_at: Date;
}

export interface TripStartVerificationEvent {
  /** What the cell said before; null when it was blank. */
  previous_observation: string | null;
  /** What it said after; null when the entry was cleared. */
  observation: string | null;
  recorded_by: string;
  recorded_initials: string;
  note: string | null;
  recorded_at: string;
}

export function shapeVerificationEvent(row: TripStartVerificationEventRow): TripStartVerificationEvent {
  return {
    previous_observation: row.previous_observation,
    observation: row.observation,
    recorded_by: row.recorded_by,
    recorded_initials: row.recorded_initials,
    note: row.note,
    recorded_at: row.recorded_at.toISOString(),
  };
}

export async function verificationEventsTableReady(pool: sql.ConnectionPool): Promise<boolean> {
  const check = await pool.request().query<{ ok: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.TripStartVerificationEvents', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok
  `);
  return check.recordset[0]?.ok === 1;
}

/** One trip's changes, newest first. */
export async function loadTripStartVerificationHistory(
  pool: sql.ConnectionPool,
  serviceDate: string,
  tripId: string,
): Promise<TripStartVerificationEvent[]> {
  const req = pool.request();
  req.input("service_date", sql.Char(8), serviceDate);
  req.input("trip_id", sql.NVarChar, tripId);
  const result = await req.query<TripStartVerificationEventRow>(`
    SELECT previous_observation, observation, recorded_by, recorded_initials, note, recorded_at
    FROM TripStartVerificationEvents
    WHERE service_date = @service_date AND trip_id = @trip_id
    ORDER BY recorded_at DESC, id DESC
  `);
  return result.recordset.map(shapeVerificationEvent);
}
