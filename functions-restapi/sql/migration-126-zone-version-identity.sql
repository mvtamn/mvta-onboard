-- Migration 126: a Zone version is identified by its monitored geometry.
--
-- Operational zones are now pulled daily from the GTFS-Flex feed Spare
-- generates for MVTA (ADR 0031). Spare stamps the export time into
-- feed_version, feed_info.txt and the archive on every call, so the natural key
-- migration 074 declared - (feed_version, source_sha256 of the archive) - would
-- make every daily pull a new version. zone_version_sha256 is a hash of the
-- monitored zones' identities, names and geometry, and is what decides whether
-- a pull is new. source_sha256 and feed_version stay, as a record of which
-- export a version was first imported from.
--
-- The last_seen_* columns and unmonitored_locations_json describe the most
-- recent pull that matched a version: when it was, which export it was, and
-- which locations Spare published that are not Operational zones (id and name
-- only, never geometry), so a new service area upstream is visible to the
-- person who activates versions.
--
-- Versions imported before this migration keep a NULL identity and are never
-- matched by a pull. On dev the table is empty.
--
-- Re-runnable.

IF OBJECT_ID(N'dbo.OnDemandOperationalZoneVersions', N'U') IS NULL
  THROW 50126, 'Migration 126 requires OnDemandOperationalZoneVersions (migration 074).', 1;
GO

IF COL_LENGTH(N'dbo.OnDemandOperationalZoneVersions', N'zone_version_sha256') IS NULL
  ALTER TABLE dbo.OnDemandOperationalZoneVersions ADD zone_version_sha256 CHAR(64) NULL;
GO

IF COL_LENGTH(N'dbo.OnDemandOperationalZoneVersions', N'last_seen_at') IS NULL
  ALTER TABLE dbo.OnDemandOperationalZoneVersions ADD last_seen_at DATETIME2 NULL;
GO

IF COL_LENGTH(N'dbo.OnDemandOperationalZoneVersions', N'last_seen_feed_version') IS NULL
  ALTER TABLE dbo.OnDemandOperationalZoneVersions ADD last_seen_feed_version NVARCHAR(200) NULL;
GO

IF COL_LENGTH(N'dbo.OnDemandOperationalZoneVersions', N'unmonitored_locations_json') IS NULL
  ALTER TABLE dbo.OnDemandOperationalZoneVersions ADD unmonitored_locations_json NVARCHAR(MAX) NULL
    CONSTRAINT CK_OnDemandOperationalZoneVersions_UnmonitoredJson
      CHECK (unmonitored_locations_json IS NULL OR ISJSON(unmonitored_locations_json) = 1);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_OnDemandOperationalZoneVersions_Identity' AND object_id = OBJECT_ID(N'dbo.OnDemandOperationalZoneVersions')
)
  CREATE UNIQUE INDEX UX_OnDemandOperationalZoneVersions_Identity
    ON dbo.OnDemandOperationalZoneVersions (zone_version_sha256)
    WHERE zone_version_sha256 IS NOT NULL;
GO

PRINT 'Migration 126 applied: Zone versions are identified by their monitored geometry.';
