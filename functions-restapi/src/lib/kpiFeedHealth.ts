// The shared, PII-free ingestion ledger behind every KPI trust stream - not
// only missed trips. dbo.MissedTripFeedHealth is the table's legacy name from
// when missed trips were its only producer; renaming it needs its own
// migration, so the storage name stays put and the module speaks KPI feeds.
import { sql } from "./db";
import type { KpiFeedName } from "./kpiTrust";

export async function recordFeedHealth(
  pool: sql.ConnectionPool,
  feedName: KpiFeedName,
  entityCount: number,
  sourceTimestampSeconds: number | null,
  coverage?: { startAt?: Date | null; endAt?: Date | null },
): Promise<void> {
  const tableCheck = await pool.request().query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.MissedTripFeedHealth', 'U') IS NULL THEN 0 ELSE 1 END AS ready
  `);
  if (tableCheck.recordset[0]?.ready !== 1) return;
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
    MERGE MissedTripFeedHealth WITH (HOLDLOCK) AS target
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
  const message = error instanceof Error ? error.message : String(error);
  await pool.request().input("feed_name", sql.NVarChar, feedName).input("reason", sql.NVarChar(1000), message.slice(0, 1000)).query(`
    IF OBJECT_ID('dbo.MissedTripFeedHealth', 'U') IS NOT NULL
      MERGE MissedTripFeedHealth WITH (HOLDLOCK) AS target
      USING (SELECT @feed_name AS feed_name) AS src ON target.feed_name = src.feed_name
      WHEN MATCHED THEN UPDATE SET last_failure_at = SYSUTCDATETIME(), last_failure_reason = @reason, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT(feed_name, last_failure_at, last_failure_reason) VALUES(@feed_name, SYSUTCDATETIME(), @reason);
  `);
}
