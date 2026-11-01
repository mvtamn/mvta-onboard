-- Migration 155: the bar that marks a first stop as a likely GPS dead zone,
-- as two admin-editable settings (lib/missedTripCase/deadZone.ts).
--
-- A missed-trip case shows how the other silent no-shows at its first stop
-- turned out (1.6.27). When at least min_cases of them could be judged and at
-- least ran_percent of those ran, the case is marked "likely GPS dead zone".
-- The bar was a constant; these rows let an admin move it on the Missed-trip
-- Detectors page, through the existing PATCH /app-settings, which refuses a
-- value outside min_value..max_value. The values below are the constants it
-- replaces, so applying this changes nothing a reviewer sees.
--
-- Until it is applied the code uses the same defaults, and the admin page says
-- the bar cannot be changed yet.
--
-- The bar only labels a case for its reviewer; it opens, holds and closes
-- nothing. updated_by/updated_at is the history it needs.
--
-- Re-runnable: an existing row, and any value an admin saved, is kept.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
  THROW 50155, 'Migration 155 requires AppSettings (migration 032a).', 1;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE module = N'missed_trip' AND setting_key = N'dead_zone_ran_percent')
  INSERT INTO dbo.AppSettings (module, setting_key, setting_value, value_type, min_value, max_value, description)
  VALUES (N'missed_trip', N'dead_zone_ran_percent', N'80', N'int', N'50', N'100',
          N'Percent of a first stop''s judged silent no-shows that must have run for its cases to be marked a likely GPS dead zone.');

IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE module = N'missed_trip' AND setting_key = N'dead_zone_min_cases')
  INSERT INTO dbo.AppSettings (module, setting_key, setting_value, value_type, min_value, max_value, description)
  VALUES (N'missed_trip', N'dead_zone_min_cases', N'5', N'int', N'3', N'50',
          N'Fewest judged silent no-shows at a first stop before it can be marked a likely GPS dead zone.');
GO

SELECT module, setting_key, setting_value, min_value, max_value FROM dbo.AppSettings WHERE module = N'missed_trip' ORDER BY setting_key;
GO
