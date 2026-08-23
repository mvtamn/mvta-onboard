-- A short operator-facing name makes multiple rules on one Monitoring Area
-- identifiable without changing their matching or notification semantics.
IF OBJECT_ID('dbo.EventGeofenceDirectionRules', 'U') IS NULL
  THROW 50066, 'Migration 066 skipped: dbo.EventGeofenceDirectionRules does not exist. Apply migration 033 first.', 1;
GO

IF COL_LENGTH('dbo.EventGeofenceDirectionRules', 'name') IS NULL
  ALTER TABLE dbo.EventGeofenceDirectionRules ADD name NVARCHAR(100) NULL;
GO

IF COL_LENGTH('dbo.EventGeofenceDirectionRules', 'name') IS NOT NULL
  PRINT 'Migration 066 applied: Event direction-rule names added.';
ELSE
  PRINT 'Migration 066 did NOT apply: dbo.EventGeofenceDirectionRules.name is still missing.';
GO
