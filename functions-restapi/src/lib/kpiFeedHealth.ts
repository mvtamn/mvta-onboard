// The shared, PII-free ingestion ledger behind every KPI trust stream - not
// only missed trips, which is where its original name came from.
import { sql } from "./db";
import type { KpiFeedName } from "./kpiTrust";

// Migration 086 renamed dbo.MissedTripFeedHealth to dbo.KpiFeedHealth.
// Resolving the name per call keeps writes working whichever of the migration
// and the deployment lands first; drop the legacy arm once 086 is applied
// everywhere. Both values are literals from this closed set, never input, so
// interpolating them into a statement introduces no injection surface.
export type FeedHealthTable = "KpiFeedHealth" | "MissedTripFeedHealth";

export async function feedHealthTable(pool: sql.ConnectionPool): Promise<FeedHealthTable | null> {
  const result = await pool.request().query<{ table_name: FeedHealthTable | null }>(`
    SELECT CASE
      WHEN OBJECT_ID('dbo.KpiFeedHealth', 'U') IS NOT NULL THEN 'KpiFeedHealth'
      WHEN OBJECT_ID('dbo.MissedTripFeedHealth', 'U') IS NOT NULL THEN 'MissedTripFeedHealth'
      ELSE NULL END AS table_name
  `);
  return result.recordset[0]?.table_name ?? null;
}

// What a completed ingestion run should write to this ledger.
//
// The ledger backs KPI trust, so its entity count has to describe what the
// KPI's table actually holds, not what the source handed over. A poller that
// records the fetched count can fetch cleanly, fail every write, and still
// advance last_success_at at full volume - and because recordFeedHealth also
// clears last_failure_at and last_failure_reason, it erases the previous run's
// recorded failure on the way past.
//
// Storing nothing from a non-empty fetch is a failure, not an empty success:
// taking the health path there is how a total ingestion loss stays invisible.
// A partial loss stays a success - one malformed record must not discard a
// good run - but it is counted honestly so callers can warn on the shortfall.
// An empty fetch is untouched: per ADR 0027 a successful run with no records is
// Current-but-empty, not a fault.
//
// This rule only fits a poller whose skipped records are failures. Where a
// poller deliberately skips records it had no reason to write - availAvlPoll
// discarding a stale observation, or a position with no trip to attach to -
// storedCount is not a loss count and this must not be used to call the run
// failed.
export type FeedHealthOutcome =
  | { kind: "failure"; reason: string }
  | { kind: "health"; entityCount: number; unstoredCount: number };

export function feedHealthOutcome(
  received: number,
  stored: number,
  noun = "records",
): FeedHealthOutcome {
  if (received > 0 && stored === 0) {
    return { kind: "failure", reason: `Fetched ${received} ${noun} but stored none.` };
  }
  return { kind: "health", entityCount: stored, unstoredCount: received - stored };
}

export async function recordFeedHealth(
  pool: sql.ConnectionPool,
  feedName: KpiFeedName,
  entityCount: number,
  sourceTimestampSeconds: number | null,
  coverage?: { startAt?: Date | null; endAt?: Date | null },
): Promise<void> {
  const table = await feedHealthTable(pool);
  if (!table) return;
  const sourceTimestamp =
    sourceTimestampSeconds && Number.isFinite(sourceTimestampSeconds)
      ? new Date(sourceTimestampSeconds * 1000)
      : null;
  const req = pool.request();
  req.input("feed_name", sql.NVarChar, feedName);
  req.input("entity_count", sql.Int, entityCount);
  req.input("source_timestamp_at", sql.DateTime2, sourceTimestamp);
  req.input("coverage_start_at", sql.DateTime2, coverage?.startAt ?? sourceTimestamp);
  req.input("coverage_end_at", sql.DateTime2, coverage?.endAt ?? sourceTimestamp);
  await req.query(`
    MERGE ${table} WITH (HOLDLOCK) AS target
    USING (SELECT @feed_name AS feed_name) AS src
    ON target.feed_name = src.feed_name
    WHEN MATCHED THEN UPDATE SET
      last_success_at = SYSUTCDATETIME(),
      last_entity_count = @entity_count,
      source_timestamp_at = @source_timestamp_at,
      coverage_start_at = @coverage_start_at,
      coverage_end_at = @coverage_end_at,
      last_failure_at = NULL,
      last_failure_reason = NULL,
      updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (
      feed_name, last_success_at, last_entity_count, source_timestamp_at, coverage_start_at, coverage_end_at
    ) VALUES (
      @feed_name, SYSUTCDATETIME(), @entity_count, @source_timestamp_at, @coverage_start_at, @coverage_end_at
    );
  `);
}

export async function recordFeedFailure(pool: sql.ConnectionPool, feedName: KpiFeedName, error: unknown): Promise<void> {
  const table = await feedHealthTable(pool);
  if (!table) return;
  const message = error instanceof Error ? error.message : String(error);
  await pool.request().input("feed_name", sql.NVarChar, feedName).input("reason", sql.NVarChar(1000), message.slice(0, 1000)).query(`
    MERGE ${table} WITH (HOLDLOCK) AS target
    USING (SELECT @feed_name AS feed_name) AS src ON target.feed_name = src.feed_name
    WHEN MATCHED THEN UPDATE SET last_failure_at = SYSUTCDATETIME(), last_failure_reason = @reason, updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT(feed_name, last_failure_at, last_failure_reason) VALUES(@feed_name, SYSUTCDATETIME(), @reason);
  `);
}
