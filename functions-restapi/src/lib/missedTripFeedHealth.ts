import { sql } from "./db";

export async function recordMissedTripFeedSuccess(
  pool: sql.ConnectionPool,
  feedName: "gtfs_trip_update" | "gtfs_vehicle_position",
  entityCount: number,
  sourceTimestampSeconds: number | null,
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
  await req.query(`
    MERGE MissedTripFeedHealth WITH (HOLDLOCK) AS target
    USING (SELECT @feed_name AS feed_name) AS src
    ON target.feed_name = src.feed_name
    WHEN MATCHED THEN UPDATE SET
      last_success_at = SYSUTCDATETIME(),
      last_entity_count = @entity_count,
      source_timestamp_at = @source_timestamp_at,
      updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (
      feed_name, last_success_at, last_entity_count, source_timestamp_at
    ) VALUES (
      @feed_name, SYSUTCDATETIME(), @entity_count, @source_timestamp_at
    );
  `);
}
