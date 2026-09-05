-- Migration 095: the Dispatch Log learns actual starts from GTFS-RT
-- (plans/dispatch-log-spec.md §5, option 1; step 5 of §8).
--
-- tripStartActualsPoll reads the TripUpdate feed every minute. MVTA's feed
-- keeps a passed stop in the list for about fifteen minutes with a realised
-- time, so the first stop's departure is read directly once it is behind the
-- feed clock. Until then it is a prediction, remembered here so that, if the
-- realised window is missed (a poll outage), the last prediction can stand in
-- for the event instead of leaving the trip unknown.

IF OBJECT_ID('dbo.TripStartLog', 'U') IS NULL
  THROW 50095, 'Migration 095 requires TripStartLog (migration 094).', 1;
GO

IF COL_LENGTH('dbo.TripStartLog', 'predicted_start_at') IS NULL
  ALTER TABLE dbo.TripStartLog ADD predicted_start_at DATETIME2 NULL;  -- last first-stop departure prediction seen
GO
IF COL_LENGTH('dbo.TripStartLog', 'actuals_updated_at') IS NULL
  ALTER TABLE dbo.TripStartLog ADD actuals_updated_at DATETIME2 NULL;  -- when the poll last changed this row
GO

-- The poll's working set: rows still without an actual, or with a
-- trip_update actual young enough to be revised while the stop lingers.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.TripStartLog') AND name = 'IX_TripStartLog_Actuals'
)
  CREATE INDEX IX_TripStartLog_Actuals ON dbo.TripStartLog (service_date, actual_start_at) INCLUDE (actual_start_source);
GO

PRINT 'Migration 095 applied: TripStartLog carries predicted_start_at and actuals_updated_at.';
