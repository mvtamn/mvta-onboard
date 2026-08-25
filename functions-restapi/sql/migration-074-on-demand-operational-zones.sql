-- Versioned GTFS-Flex service areas for on-demand service-quality monitoring.
-- Pickup coordinates are resolved transiently; snapshots retain only the zone
-- result, never a rider's precise pickup location.

CREATE TABLE dbo.OnDemandOperationalZoneVersions (
    id            UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    feed_version  NVARCHAR(200)    NOT NULL,
    source_sha256 CHAR(64)         NOT NULL,
    is_active     BIT              NOT NULL DEFAULT 0,
    imported_at   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    imported_by   NVARCHAR(200)    NULL,
    CONSTRAINT UQ_OnDemandOperationalZoneVersions_Source UNIQUE (feed_version, source_sha256)
);
GO

CREATE UNIQUE INDEX UX_OnDemandOperationalZoneVersions_Active
    ON dbo.OnDemandOperationalZoneVersions (is_active)
    WHERE is_active = 1;
GO

CREATE TABLE dbo.OnDemandOperationalZones (
    id                   UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    zone_version_id      UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.OnDemandOperationalZoneVersions(id),
    external_location_id NVARCHAR(100)    NOT NULL,
    name                 NVARCHAR(200)    NOT NULL,
    geometry_json        NVARCHAR(MAX)    NOT NULL,
    CONSTRAINT UQ_OnDemandOperationalZones_Source UNIQUE (zone_version_id, external_location_id),
    CONSTRAINT CK_OnDemandOperationalZones_GeometryJson CHECK (ISJSON(geometry_json) = 1)
);
GO

CREATE TABLE dbo.OnDemandRequestZoneSnapshots (
    request_id       NVARCHAR(100)    NOT NULL PRIMARY KEY,
    zone_version_id  UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.OnDemandOperationalZoneVersions(id),
    zone_id          UNIQUEIDENTIFIER NULL REFERENCES dbo.OnDemandOperationalZones(id),
    resolution       NVARCHAR(40)     NOT NULL,
    assigned_at      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_OnDemandRequestZoneSnapshots_Resolution CHECK (
        resolution IN ('assigned', 'missing_pickup_coordinate', 'outside_operational_zones', 'ambiguous_operational_zones')
    ),
    CONSTRAINT CK_OnDemandRequestZoneSnapshots_Assignment CHECK (
        (resolution = 'assigned' AND zone_id IS NOT NULL)
        OR (resolution <> 'assigned' AND zone_id IS NULL)
    )
);
GO

PRINT 'Migration 074 applied: versioned On-Demand Operational zones and non-PII request zone snapshots created.';
