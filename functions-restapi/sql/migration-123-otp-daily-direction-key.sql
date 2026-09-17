-- Migration 123: OtpDailyRouteStopHour is keyed by direction as well.
--
-- Avail's OtpByRouteStopDayHour returns one row per direction a route serves a
-- stop in an hour: route 446 at one stop at 06:00 comes back as an N row and an
-- S row. Migration 020 keyed the table on (calendar_date, route_id, stop_id,
-- hour_of_day), guessed before any real response existed, so the second
-- direction's MERGE matched the first and overwrote it. Against the live
-- response for 2026-09-15, 1,988 rows collapse to 1,616 keys: about one row in
-- five would have been lost, and every overwrite still counted as a stored
-- row, so feed health could not have shown it.
--
-- The table has held no rows on dev (the poll asked for a service day that had
-- not finished; fixed in the same change), but this is written for a table that
-- has them: widening a unique key cannot create a duplicate, so no data is
-- touched.
--
-- direction stays nullable. SQL Server's UNIQUE constraint treats NULLs as
-- equal, which is the behaviour wanted for a row with no direction, and the
-- poll's MERGE matches NULL to NULL explicitly.
--
-- Re-runnable.

IF OBJECT_ID(N'dbo.OtpDailyRouteStopHour', N'U') IS NULL
  THROW 50123, 'Migration 123 requires OtpDailyRouteStopHour (migration 020).', 1;
GO

IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = N'UX_OtpDailyRouteStopHour_Key' AND parent_object_id = OBJECT_ID(N'dbo.OtpDailyRouteStopHour')
)
  ALTER TABLE dbo.OtpDailyRouteStopHour DROP CONSTRAINT UX_OtpDailyRouteStopHour_Key;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = N'UX_OtpDailyRouteStopHour_DirectionKey' AND parent_object_id = OBJECT_ID(N'dbo.OtpDailyRouteStopHour')
)
  ALTER TABLE dbo.OtpDailyRouteStopHour
    ADD CONSTRAINT UX_OtpDailyRouteStopHour_DirectionKey
    UNIQUE (calendar_date, route_id, stop_id, hour_of_day, direction);
GO

PRINT 'Migration 123 applied: OtpDailyRouteStopHour keyed by direction.';
