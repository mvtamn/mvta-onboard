-- Migration 097: record who put a zone version into force.
--
-- OnDemandOperationalZoneVersions (migration 074) records imported_by, but
-- importing is the harmless half. Activating is what changes the boundaries a
-- live monitor resolves pickups against, and so changes which requests are
-- judged in-zone and which are recorded unzoned. Until now that act left no
-- trace in the database at all - only a line in the Function App's logs, which
-- is not where anyone reviewing a disputed zone assignment will look.
--
-- Nullable, because every version imported before this migration was activated
-- without the columns existing; NULL means "not recorded", which is honest,
-- and inventing a value for those rows would fabricate an audit trail.

IF OBJECT_ID('dbo.OnDemandOperationalZoneVersions', 'U') IS NULL
  THROW 50097, 'Migration 097 requires OnDemandOperationalZoneVersions (migration 074).', 1;
GO

IF COL_LENGTH('dbo.OnDemandOperationalZoneVersions', 'activated_by') IS NULL
  ALTER TABLE dbo.OnDemandOperationalZoneVersions ADD activated_by NVARCHAR(200) NULL;
GO

IF COL_LENGTH('dbo.OnDemandOperationalZoneVersions', 'activated_at') IS NULL
  ALTER TABLE dbo.OnDemandOperationalZoneVersions ADD activated_at DATETIME2 NULL;
GO

PRINT 'Migration 097 applied: on-demand zone version activation is attributed.';
