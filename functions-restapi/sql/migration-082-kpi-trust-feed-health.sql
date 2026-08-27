-- Reuse the existing PII-free feed-health ledger as the common KPI trust input.
-- Older missed-trip producer keys become the canonical KPI dependency keys.
IF OBJECT_ID(N'dbo.MissedTripFeedHealth', N'U') IS NOT NULL
BEGIN
  ;WITH LegacyRows AS (
    SELECT
      CASE feed_name
        WHEN N'gtfs_trip_update' THEN N'gtfs_trip_updates'
        WHEN N'gtfs_vehicle_position' THEN N'gtfs_vehicle_positions'
      END AS feed_name,
      last_success_at, last_entity_count, source_timestamp_at
    FROM dbo.MissedTripFeedHealth
    WHERE feed_name IN (N'gtfs_trip_update', N'gtfs_vehicle_position')
  )
  MERGE dbo.MissedTripFeedHealth WITH (HOLDLOCK) AS target
  USING LegacyRows AS source ON target.feed_name = source.feed_name
  WHEN MATCHED THEN UPDATE SET
    last_success_at = CASE WHEN COALESCE(target.last_success_at, '19000101') >= COALESCE(source.last_success_at, '19000101') THEN target.last_success_at ELSE source.last_success_at END,
    last_entity_count = CASE WHEN COALESCE(target.last_success_at, '19000101') >= COALESCE(source.last_success_at, '19000101') THEN target.last_entity_count ELSE source.last_entity_count END,
    source_timestamp_at = CASE WHEN COALESCE(target.last_success_at, '19000101') >= COALESCE(source.last_success_at, '19000101') THEN target.source_timestamp_at ELSE source.source_timestamp_at END,
    updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN INSERT (feed_name, last_success_at, last_entity_count, source_timestamp_at)
    VALUES (source.feed_name, source.last_success_at, source.last_entity_count, source.source_timestamp_at);

  DELETE FROM dbo.MissedTripFeedHealth
  WHERE feed_name IN (N'gtfs_trip_update', N'gtfs_vehicle_position');
END;
GO

PRINT 'Migration 082 verified: shared KPI trust feed health keys are canonical.';
