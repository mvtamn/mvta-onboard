// Reviewing exclusions against a service month: writing a decision down,
// reading a month's decisions back, and showing what happened as one timeline.
//
// These were handlers with no library between them. Writing a Stop Exclusion,
// reading it back, and describing it in the Audit Stream each knew the table
// separately, and the Audit Stream knew both tables plus the merge. Nothing was
// testable, because none of it was reachable except over HTTP.
//
// Weather Day Exclusions are READ here, for the timeline, and never written:
// ADR 0038 gave them an approval flow of their own, with a snapshot frozen in
// the same transaction (lib/otpDateExclusionSnapshot). That is deliberately
// left where it is rather than pulled behind this interface.
//
// **The timeline is derived from the records, not from a log.** There is no
// audit table: `timeline` reads OtpStopExclusions and OtpDateExclusions
// themselves, the way the console's own Audit Log reads messages. That means a
// corrected row corrects its own history and the two can never disagree. It
// also means only the CURRENT state of a decision is visible: re-reviewing a
// stop upserts in place, so "approved, then rejected, then approved again"
// reads as one entry at the latest time. That limitation predates this module
// and is deliberately kept rather than quietly fixed - showing a reviewer's
// changed mind needs a table, a migration, and somebody at MVTA saying it is
// wanted.
import { sql } from "../db";
import type { Executor } from "../otpMonth";
import type {
  ExclusionAuditEntry,
  StopExclusionDecision,
  StopExclusionRecord,
  WeatherDayRecord,
} from "./types";

export * from "./types";

const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

const DEFAULT_TIMELINE_LIMIT = 50;
const MAX_TIMELINE_LIMIT = 200;

interface Available {
  stops: boolean;
  dates: boolean;
}

/**
 * Whether the two tables exist, in one round trip. Migration 018 creates both,
 * and an environment without it must still answer rather than fail - a
 * reviewer with no tables sees an empty month, not a 500.
 */
async function available(executor: Executor): Promise<Available> {
  const probe = await request(executor).query<{ stops: number; dates: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.OtpStopExclusions', 'U') IS NULL THEN 0 ELSE 1 END AS stops,
           CASE WHEN OBJECT_ID('dbo.OtpDateExclusions', 'U') IS NULL THEN 0 ELSE 1 END AS dates
  `);
  const row = probe.recordset[0];
  return { stops: row?.stops === 1, dates: row?.dates === 1 };
}

/**
 * A Weather Day Exclusion belongs to the month its service date falls in.
 * `service_date` is CHAR(8) 'YYYYMMDD', so its month is the first six - never
 * `created_at`, which is when somebody typed it in and can be a month later.
 */
const WEATHER_MONTH_TEST = "LEFT(service_date, 6) = @service_month";

/** Write a reviewer's decision about one stop. Re-reviewing upserts in place. */
export async function recordStopExclusion(
  executor: Executor,
  decision: StopExclusionDecision,
  reviewedBy: string,
): Promise<StopExclusionRecord> {
  const req = request(executor);
  req.input("service_month", sql.Char(6), decision.service_month);
  req.input("route_id", sql.Int, decision.route_id);
  req.input("stop_id", sql.Int, decision.stop_id);
  // NVarChar(20), not (3) - migration 022: real Avail day_of_week values
  // overflowed the original "Mon"/"Tue"-sized column.
  req.input("day_of_week", sql.NVarChar(20), decision.day_of_week);
  req.input("status", sql.NVarChar(10), decision.status);
  req.input("reason_code", sql.NVarChar, decision.reason_code ?? null);
  req.input("reviewed_by", sql.NVarChar, reviewedBy);

  const result = await req.query<StopExclusionRecord>(`
    MERGE OtpStopExclusions WITH (HOLDLOCK) AS target
    USING (
      SELECT @service_month AS service_month, @route_id AS route_id,
             @stop_id AS stop_id, @day_of_week AS day_of_week
    ) AS src
    ON target.service_month = src.service_month AND target.route_id = src.route_id
       AND target.stop_id = src.stop_id AND target.day_of_week = src.day_of_week
    WHEN MATCHED THEN
      UPDATE SET status = @status, reason_code = @reason_code,
        reviewed_by = @reviewed_by, reviewed_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (service_month, route_id, stop_id, day_of_week, status, reason_code, reviewed_by)
      VALUES (@service_month, @route_id, @stop_id, @day_of_week, @status, @reason_code, @reviewed_by)
    OUTPUT INSERTED.id, INSERTED.service_month, INSERTED.route_id, INSERTED.stop_id,
           INSERTED.day_of_week, INSERTED.status, INSERTED.reason_code,
           INSERTED.reviewed_by, INSERTED.reviewed_at;
  `);
  return result.recordset[0]!;
}

/** Every reviewed Stop Exclusion for a month. */
export async function stopExclusionsForMonth(
  executor: Executor,
  month: string,
): Promise<StopExclusionRecord[]> {
  if (!(await available(executor)).stops) return [];
  const req = request(executor);
  req.input("service_month", sql.Char(6), month);
  const result = await req.query<StopExclusionRecord>(`
    SELECT id, service_month, route_id, stop_id, day_of_week, status, reason_code,
           reviewed_by, reviewed_at
    FROM OtpStopExclusions
    WHERE service_month = @service_month
    ORDER BY reviewed_at DESC
  `);
  return result.recordset;
}

/** Interleave two kinds of record into one timeline, newest first. */
export function mergeAuditEntries(
  stops: readonly StopExclusionRecord[],
  weatherDays: readonly WeatherDayRecord[],
  limit: number,
): ExclusionAuditEntry[] {
  const entries: ExclusionAuditEntry[] = [
    ...stops.map((row): ExclusionAuditEntry => ({
      kind: "stop_exclusion",
      at: new Date(row.reviewed_at).toISOString(),
      actor: row.reviewed_by,
      reason_code: row.reason_code,
      route_id: row.route_id,
      stop_id: row.stop_id,
      day_of_week: row.day_of_week,
      status: row.status,
    })),
    ...weatherDays.map((row): ExclusionAuditEntry => ({
      kind: "weather_day",
      at: new Date(row.created_at).toISOString(),
      actor: row.created_by,
      reason_code: row.reason_code,
      scope: row.scope,
      route_id: row.route_id,
      service_date: row.service_date,
    })),
  ];
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return entries.slice(0, Math.max(0, limit));
}

/** The number of entries a caller may ask for, clamped. */
export function timelineLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_TIMELINE_LIMIT;
  }
  return Math.min(Math.trunc(requested), MAX_TIMELINE_LIMIT);
}

/**
 * What happened, as one timeline. `month` scopes BOTH kinds - it reached only
 * the stop exclusions until 1.5.291, so a stream scoped to one month still
 * listed every weather day ever recorded. Each query is bounded in SQL, so a
 * long history costs the same as a short one.
 */
export async function timeline(
  executor: Executor,
  options: { month?: string | null; limit?: number } = {},
): Promise<ExclusionAuditEntry[]> {
  const month = options.month ?? null;
  const limit = timelineLimit(options.limit);
  const tables = await available(executor);

  const stops: StopExclusionRecord[] = [];
  if (tables.stops) {
    const req = request(executor);
    req.input("limit", sql.Int, limit);
    if (month) req.input("service_month", sql.Char(6), month);
    const result = await req.query<StopExclusionRecord>(`
      SELECT TOP (@limit) id, service_month, route_id, stop_id, day_of_week, status,
             reason_code, reviewed_by, reviewed_at
      FROM OtpStopExclusions
      ${month ? "WHERE service_month = @service_month" : ""}
      ORDER BY reviewed_at DESC
    `);
    stops.push(...result.recordset);
  }

  const weatherDays: WeatherDayRecord[] = [];
  if (tables.dates) {
    const req = request(executor);
    req.input("limit", sql.Int, limit);
    if (month) req.input("service_month", sql.Char(6), month);
    const result = await req.query<WeatherDayRecord>(`
      SELECT TOP (@limit) id, scope, route_id, service_date, reason_code, notes, status,
             notified, notified_at, acknowledged, created_by, created_at
      FROM OtpDateExclusions
      ${month ? `WHERE ${WEATHER_MONTH_TEST}` : ""}
      ORDER BY created_at DESC
    `);
    weatherDays.push(...result.recordset);
  }

  return mergeAuditEntries(stops, weatherDays, limit);
}
