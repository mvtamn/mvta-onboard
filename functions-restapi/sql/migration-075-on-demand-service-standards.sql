-- Persisted, auditable wait-time standards for MVTA Connect.
CREATE TABLE dbo.OnDemandServiceStandardPolicy (
    id                  TINYINT NOT NULL PRIMARY KEY CONSTRAINT CK_OnDemandServiceStandardPolicy_Singleton CHECK (id = 1),
    default_minutes     INT NOT NULL CONSTRAINT CK_OnDemandServiceStandardPolicy_Minutes CHECK (default_minutes BETWEEN 10 AND 60),
    updated_by          NVARCHAR(320) NULL,
    updated_at          DATETIME2 NOT NULL CONSTRAINT DF_OnDemandServiceStandardPolicy_Updated DEFAULT SYSUTCDATETIME()
);
INSERT INTO dbo.OnDemandServiceStandardPolicy (id, default_minutes)
VALUES (1, 25);

CREATE TABLE dbo.OnDemandZoneServiceStandardOverrides (
    id                  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    -- Stable GTFS-Flex identity, not a version-specific zone row id. A policy
    -- remains applicable when an otherwise unchanged zone is re-imported.
    external_location_id NVARCHAR(200) NOT NULL,
    minutes             INT NOT NULL CONSTRAINT CK_OnDemandZoneServiceStandardOverrides_Minutes CHECK (minutes BETWEEN 10 AND 60),
    reason              NVARCHAR(500) NOT NULL,
    effective_at        DATETIME2 NOT NULL,
    expires_at          DATETIME2 NOT NULL,
    created_by          NVARCHAR(320) NULL,
    created_at          DATETIME2 NOT NULL CONSTRAINT DF_OnDemandZoneServiceStandardOverrides_Created DEFAULT SYSUTCDATETIME(),
    updated_by          NVARCHAR(320) NULL,
    updated_at          DATETIME2 NOT NULL CONSTRAINT DF_OnDemandZoneServiceStandardOverrides_Updated DEFAULT SYSUTCDATETIME(),
    revoked_by          NVARCHAR(320) NULL,
    revoked_at          DATETIME2 NULL,
    CONSTRAINT CK_OnDemandZoneServiceStandardOverrides_Window CHECK (expires_at > effective_at)
);
CREATE UNIQUE INDEX UX_OnDemandZoneServiceStandardOverrides_OpenZone
    ON dbo.OnDemandZoneServiceStandardOverrides(external_location_id) WHERE revoked_at IS NULL;

CREATE TABLE dbo.OnDemandServiceStandardAudit (
    id                  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    action              NVARCHAR(30) NOT NULL CONSTRAINT CK_OnDemandServiceStandardAudit_Action CHECK (action IN ('default_updated', 'override_created', 'override_updated', 'override_removed')),
    zone_override_id    UNIQUEIDENTIFIER NULL REFERENCES dbo.OnDemandZoneServiceStandardOverrides(id),
    detail_json         NVARCHAR(MAX) NOT NULL CONSTRAINT CK_OnDemandServiceStandardAudit_DetailJson CHECK (ISJSON(detail_json) = 1),
    occurred_by         NVARCHAR(320) NULL,
    occurred_at         DATETIME2 NOT NULL CONSTRAINT DF_OnDemandServiceStandardAudit_Occurred DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_OnDemandServiceStandardAudit_Occurred ON dbo.OnDemandServiceStandardAudit(occurred_at DESC);
