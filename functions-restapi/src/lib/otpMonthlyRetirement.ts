import sql from "mssql";
import type { MappedOtpMonthlyReport } from "./otpMonthlyFeed";

// Retiring the OTP monthly keys Avail has stopped returning (ADR 0043).
//
// The monthly upsert inserts and updates; it has never had an opinion about a
// stored key its payload did not mention, because a MERGE cannot have one. So
// a route/stop/day of week that Avail stops publishing for a month stays in
// the table at whatever figure it last held, and - since migration 151 - at
// whatever measurement standard last reached it, which is now none. ADR 0042's
// re-pull list reads an unstamped row as "not measured under the set in force",
// correctly, and such a row cannot be stamped by any poll, so the month never
// leaves the list.
//
// What makes this safe or dangerous is one question: is "absent from the
// payload" a fact about the month, or about this one delivery? A short response
// looks identical to a shrunken month, and acting on the wrong one deletes real
// figures. So absence alone retires nothing. The payload has to account for
// essentially all of the month first (`RETIREMENT_MIN_COVERAGE`), and when it
// does not, the run says what it would have retired and retires nothing - the
// loud nothing being the point, because a month that genuinely lost a tenth of
// its keys is a question for a human, not a cleanup.

/**
 * The share of a month's stored keys the payload must account for before any
 * absent key is retired.
 *
 * 0.9 is a judgement, and a deliberately unambitious one. The real cases seen
 * so far are 1-8 keys out of 850-1,000 (0.1-0.9%), so anything short of near
 * total coverage is not the case this exists for. What the number has to rule
 * out is a truncated or partially-failed response, where the arithmetic that
 * says "these 300 keys are gone" is arithmetic over a bad delivery.
 */
export const RETIREMENT_MIN_COVERAGE = 0.9;

export interface RetirementCoverage {
  /** Keys the month holds in the live table. */
  stored: number;
  /** Stored keys this payload returned. */
  returned: number;
  /** Stored keys this payload did not return. */
  absent: number;
}

export interface RetirementDecision {
  retire: boolean;
  coverage: number;
  /** Why, in words, whether it retires or not - logged either way. */
  reason: string;
}

/**
 * Whether this payload has earned the right to retire the keys it did not
 * return.
 *
 * Pure, so the gate is testable without a database and reads the same whether
 * the caller is the nightly poll or an admin's backfill.
 */
export function retirementDecision(coverage: RetirementCoverage): RetirementDecision {
  const { stored, returned, absent } = coverage;
  if (stored === 0) {
    return { retire: false, coverage: 1, reason: "the month holds no rows, so there is nothing to retire" };
  }
  if (absent === 0) {
    return { retire: false, coverage: 1, reason: "every stored key came back" };
  }
  const share = returned / stored;
  if (share < RETIREMENT_MIN_COVERAGE) {
    return {
      retire: false,
      coverage: share,
      reason:
        `${absent} of ${stored} stored keys were absent, but the payload accounted for only ` +
        `${(share * 100).toFixed(1)}% of the month (needs ${(RETIREMENT_MIN_COVERAGE * 100).toFixed(0)}%) - ` +
        "too short a delivery to tell a shrunken month from a bad response, so nothing was retired",
    };
  }
  return {
    retire: true,
    coverage: share,
    reason: `${absent} of ${stored} stored keys were not returned by a payload covering ${(share * 100).toFixed(1)}% of the month`,
  };
}

/**
 * Whether migration 152's archive exists. Read once per month polled, not per
 * row, and answered honestly: a poll that cannot archive a row must not delete
 * it either.
 */
export async function retirementArchiveReady(pool: sql.ConnectionPool): Promise<boolean> {
  const probe = await pool.request().query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.OtpMonthlyRetiredKeys','U') IS NULL THEN 0 ELSE 1 END ready
  `);
  return probe.recordset[0]?.ready === 1;
}

/** One retired key, for the log line and the console's backfill panel. */
export interface RetiredKey {
  route_id: number;
  stop_id: number;
  day_of_week: string;
  stop_name: string | null;
  total: number | null;
  ontime: number | null;
  measured_under: string | null;
}

export interface RetireVanishedKeysInput {
  serviceMonth: string;
  /**
   * The keys this payload returned, after collapsing - the same rows that were
   * upserted. Passed rather than re-read, because the question is what THIS
   * delivery contained.
   */
  returned: readonly Pick<MappedOtpMonthlyReport, "route_id" | "stop_id" | "day_of_week">[];
  /** What did the retiring, for the archive: a poller name or a principal. */
  retiredBy: string;
  /** From `retirementArchiveReady`. Without the archive nothing is deleted. */
  archiveReady: boolean;
}

export interface RetireVanishedKeysResult extends RetirementDecision {
  stored: number;
  absent: number;
  /** The keys actually archived and removed - empty whenever `retire` is false. */
  retired: RetiredKey[];
}

/** `describeRetirement`-friendly one-liner per key. */
export function describeRetiredKey(serviceMonth: string, key: RetiredKey): string {
  const where = key.stop_name ? `${key.stop_name} (stop ${key.stop_id})` : `stop ${key.stop_id}`;
  const figures =
    key.total === null
      ? "no departures recorded"
      : `${key.total} departure${key.total === 1 ? "" : "s"}, ${key.ontime ?? 0} on time`;
  return (
    `${serviceMonth}: route ${key.route_id} at ${where} on ${key.day_of_week} - ${figures}, ` +
    `measured under ${key.measured_under ?? "no recorded standard"} - retired, Avail no longer returns it`
  );
}

/**
 * Archive and remove the month's keys this payload did not return, if it
 * covered enough of the month to be believed.
 *
 * Two round trips, once per month polled, not per row: one to count what is
 * stored against what came back, one to move what is gone. The keys cross as
 * JSON rather than a temp table because a pooled request is not guaranteed the
 * same connection twice, and OPENJSON needs neither.
 */
export async function retireVanishedMonthlyKeys(
  pool: sql.ConnectionPool,
  input: RetireVanishedKeysInput,
): Promise<RetireVanishedKeysResult> {
  const payload = JSON.stringify(
    input.returned.map((key) => ({ r: key.route_id, s: key.stop_id, d: key.day_of_week })),
  );

  const counts = await pool
    .request()
    .input("service_month", sql.Char(6), input.serviceMonth)
    .input("returned", sql.NVarChar(sql.MAX), payload).query<{ stored: number; returned: number }>(`
      WITH returned AS (
        SELECT route_id, stop_id, day_of_week
        FROM OPENJSON(@returned)
        WITH (route_id INT '$.r', stop_id INT '$.s', day_of_week NVARCHAR(20) '$.d')
      )
      SELECT COUNT(*) stored,
             SUM(CASE WHEN EXISTS (
               SELECT 1 FROM returned k
               WHERE k.route_id = m.route_id AND k.stop_id = m.stop_id
                 AND k.day_of_week = m.day_of_week
             ) THEN 1 ELSE 0 END) returned
      FROM dbo.OtpMonthlyRouteStopDay m
      WHERE m.service_month = @service_month
    `);

  const stored = counts.recordset[0]?.stored ?? 0;
  const returned = counts.recordset[0]?.returned ?? 0;
  const decision = retirementDecision({ stored, returned, absent: stored - returned });
  const result: RetireVanishedKeysResult = { ...decision, stored, absent: stored - returned, retired: [] };

  if (!decision.retire) return result;
  if (!input.archiveReady) {
    // The archive is where a retired row still exists. Without it the delete
    // would be the only record of itself, so the row stays and the month keeps
    // saying what it says.
    return {
      ...result,
      retire: false,
      reason: `${decision.reason}, but migration 152's archive is not applied, so nothing was retired`,
    };
  }

  const reason =
    `Retired by ${input.retiredBy}: ${input.serviceMonth} was polled and Avail did not return this ` +
    `route/stop/day of week, in a payload accounting for ${(decision.coverage * 100).toFixed(1)}% of the month's stored keys.`;

  // Three statements in one transaction, not composable DML: an INSERT whose
  // source is a DELETE ... OUTPUT cannot itself carry an OUTPUT clause, and the
  // caller needs the retired rows back to log and display them. OUTPUT INTO a
  // table variable gets both, and XACT_ABORT with the explicit transaction
  // closes the window where a row could be deleted but not archived.
  const gone = await pool
    .request()
    .input("service_month", sql.Char(6), input.serviceMonth)
    .input("returned", sql.NVarChar(sql.MAX), payload)
    .input("retired_reason", sql.NVarChar(400), reason)
    .input("retired_by", sql.NVarChar(200), input.retiredBy).query<RetiredKey>(`
      SET XACT_ABORT ON;
      DECLARE @gone TABLE (
        service_month CHAR(6), route_id INT, stop_id INT, day_of_week NVARCHAR(20),
        stop_name NVARCHAR(200), route_label NVARCHAR(100),
        pct_early FLOAT, pct_ontime FLOAT, pct_late FLOAT, pct_not_ontime FLOAT, pct_missed FLOAT,
        early INT, ontime INT, late INT, missed INT, actual_departures INT, total INT,
        first_seen_at DATETIME2, updated_at DATETIME2, measurement_parameters NVARCHAR(40)
      );

      BEGIN TRANSACTION;

      DELETE m
      FROM dbo.OtpMonthlyRouteStopDay m
      WHERE m.service_month = @service_month
        AND NOT EXISTS (
          SELECT 1
          FROM OPENJSON(@returned)
            WITH (route_id INT '$.r', stop_id INT '$.s', day_of_week NVARCHAR(20) '$.d') k
          WHERE k.route_id = m.route_id AND k.stop_id = m.stop_id
            AND k.day_of_week = m.day_of_week
        )
      OUTPUT deleted.service_month, deleted.route_id, deleted.stop_id, deleted.day_of_week,
             deleted.stop_name, deleted.route_label,
             deleted.pct_early, deleted.pct_ontime, deleted.pct_late,
             deleted.pct_not_ontime, deleted.pct_missed,
             deleted.early, deleted.ontime, deleted.late, deleted.missed,
             deleted.actual_departures, deleted.total,
             deleted.first_seen_at, deleted.updated_at, deleted.measurement_parameters
      INTO @gone;

      INSERT INTO dbo.OtpMonthlyRetiredKeys (
        service_month, route_id, stop_id, day_of_week, stop_name, route_label,
        pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
        early, ontime, late, missed, actual_departures, total,
        first_seen_at, updated_at, measurement_parameters, retired_reason, retired_by
      )
      SELECT service_month, route_id, stop_id, day_of_week, stop_name, route_label,
             pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
             early, ontime, late, missed, actual_departures, total,
             first_seen_at, updated_at, measurement_parameters, @retired_reason, @retired_by
      FROM @gone;

      COMMIT TRANSACTION;

      SELECT route_id, stop_id, day_of_week, stop_name, total, ontime,
             measurement_parameters AS measured_under
      FROM @gone
      ORDER BY route_id, stop_id, day_of_week;
    `);

  return { ...result, retired: gone.recordset };
}
