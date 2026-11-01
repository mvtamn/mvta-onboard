// Likely GPS dead zones: first stops where most of the silent no-shows the
// evidence could judge turned out to have run.
//
// One place for the bar, the cases it is measured over and the per-stop
// record, so the case detail (caseEvidence.ts) and the Missed-trip Detectors
// admin table cannot disagree about which stops it flags. The bar is two
// AppSettings rows (module 'missed_trip', migration 155) an admin edits through
// PATCH /app-settings; without them the defaults below apply.
//
// The bar only labels a case for its reviewer. It opens, holds and closes
// nothing, and touches no count or assessment - which is why a last-changed-by
// is enough history for it. If dead zones ever feed detection, that changes.
import { sql } from "../db";
import { operatedSql } from "./adapters/gtfs";

export interface DeadZoneBar {
  /** Share of a stop's judged cases that ran, as a whole percent. */
  ran_percent: number;
  /** Fewest judged cases before a stop's record says anything. */
  min_cases: number;
}

export const DEFAULT_DEAD_ZONE_BAR: DeadZoneBar = { ran_percent: 80, min_cases: 5 };

// The ranges migration 155 declares, so PATCH /app-settings refuses anything
// outside them. Repeated here so a row edited by hand past them is not trusted.
export const DEAD_ZONE_LIMITS = {
  ran_percent: { min: 50, max: 100 },
  min_cases: { min: 3, max: 50 },
} as const;

export const DEAD_ZONE_SETTINGS_MODULE = "missed_trip";
const KEYS = { ran_percent: "dead_zone_ran_percent", min_cases: "dead_zone_min_cases" } as const;

// Cases a stop's record leaves out, because the evidence could not judge them.
// Retired cases (migration 148) were raised before the guards, many on days
// the feeds were down; data-gap cases were raised while the position feed was
// not current. Either shows "no start" because of the feed, not the stop. Seen
// live 2026-10-22: counting them put Savage Park & Ride at 38 of 82 ran, when
// every one of its 27 cases since the guards had run.
export const UNJUDGEABLE_QUALITY = "N'legacy_unverified', N'unknown_data_gap'";

export function isLikelyDeadZone(cases: number, ran: number, bar: DeadZoneBar): boolean {
  return cases > 0 && cases >= bar.min_cases && (ran / cases) * 100 >= bar.ran_percent;
}

function settingValue(rows: readonly { setting_key: string; setting_value: string }[], key: keyof DeadZoneBar): number {
  const raw = rows.find((row) => row.setting_key === KEYS[key])?.setting_value;
  const value = raw === undefined ? NaN : Number(raw);
  const { min, max } = DEAD_ZONE_LIMITS[key];
  return Number.isInteger(value) && value >= min && value <= max ? value : DEFAULT_DEAD_ZONE_BAR[key];
}

/** The bar from its AppSettings rows; configured says whether migration 155's rows exist. */
export function deadZoneBarFrom(rows: readonly { setting_key: string; setting_value: string }[]): DeadZoneBar & { configured: boolean } {
  return {
    ran_percent: settingValue(rows, "ran_percent"),
    min_cases: settingValue(rows, "min_cases"),
    configured: rows.some((row) => row.setting_key === KEYS.ran_percent || row.setting_key === KEYS.min_cases),
  };
}

export async function readDeadZoneBar(pool: sql.ConnectionPool): Promise<DeadZoneBar & { configured: boolean }> {
  const result = await pool.request()
    .input("module", sql.NVarChar(50), DEAD_ZONE_SETTINGS_MODULE)
    .query<{ setting_key: string; setting_value: string }>(`
      IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
        SELECT CAST(NULL AS NVARCHAR(100)) AS setting_key, CAST(NULL AS NVARCHAR(500)) AS setting_value WHERE 1 = 0
      ELSE
        SELECT setting_key, setting_value FROM AppSettings WHERE module = @module`);
  return deadZoneBarFrom(result.recordset);
}

/**
 * Judged silent no-shows and how many ran, per first stop, as SQL - grouped by
 * origin_stop_id with the stop's name. `stopFilter` narrows the stops (a
 * predicate over `hl.origin_stop_id`); omitted, every stop is counted.
 */
export function stopRecordsSql(stopFilter?: string): string {
  return `
    SELECT hl.origin_stop_id,
           MAX(hl.origin_stop_name) AS origin_stop_name,
           COUNT(*) AS origin_cases,
           SUM(CASE WHEN ${operatedSql("he", "hl")} THEN 1 ELSE 0 END) AS origin_cases_ran
    FROM MonitoredMissedTrips hm
    JOIN TripStartLog hl ON hl.trip_id = hm.trip_id AND CAST(hl.service_date AS NVARCHAR(20)) = hm.service_date
    LEFT JOIN GtfsTripOperationalEvidence he ON he.trip_id = hm.trip_id AND he.service_date = hm.service_date
    WHERE hm.detection_type = N'silent_no_show'
      AND hm.data_quality_status NOT IN (${UNJUDGEABLE_QUALITY})
      AND hl.origin_stop_id IS NOT NULL
      ${stopFilter ? `AND ${stopFilter}` : ""}
    GROUP BY hl.origin_stop_id`;
}

export interface FirstStopRecord {
  stop_id: string;
  name: string | null;
  cases: number;
  ran: number;
}

/** Every first stop with a judged silent no-show, most cases first. Empty without the tables. */
export async function readFirstStopRecords(pool: sql.ConnectionPool): Promise<FirstStopRecord[]> {
  const ready = await pool.request().query<{ ok: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.TripStartLog', 'U') IS NOT NULL
                 AND OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NOT NULL
                 AND OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok`);
  if (ready.recordset[0]?.ok !== 1) return [];
  const result = await pool.request().query<{ origin_stop_id: string; origin_stop_name: string | null; origin_cases: number; origin_cases_ran: number }>(`
    SELECT r.* FROM (${stopRecordsSql()}) r
    ORDER BY r.origin_cases DESC, r.origin_stop_name`);
  return result.recordset.map((row) => ({
    stop_id: row.origin_stop_id,
    name: row.origin_stop_name,
    cases: row.origin_cases,
    ran: row.origin_cases_ran,
  }));
}
