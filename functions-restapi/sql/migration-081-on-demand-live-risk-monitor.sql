-- Current non-PII request state behind the On-Demand Service Quality monitor.
-- A terminal row is retained so a delayed webhook retry cannot reopen it.
ALTER TABLE dbo.MonitoredOnDemandWaits ADD
    monitor_state NVARCHAR(20) NOT NULL CONSTRAINT DF_MonitoredOnDemandWaits_MonitorState DEFAULT 'active',
    duty_id NVARCHAR(100) NULL,
    initial_scheduled_pickup_at DATETIME2 NULL,
    scheduled_pickup_at DATETIME2 NULL,
    pickup_arrived_at DATETIME2 NULL,
    zone_resolution NVARCHAR(40) NOT NULL CONSTRAINT DF_MonitoredOnDemandWaits_ZoneResolution DEFAULT 'legacy_unknown';
GO

ALTER TABLE dbo.MonitoredOnDemandWaits ADD CONSTRAINT CK_MonitoredOnDemandWaits_MonitorState
    CHECK (monitor_state IN ('active', 'completed', 'cancelled'));
GO
ALTER TABLE dbo.MonitoredOnDemandWaits ADD CONSTRAINT CK_MonitoredOnDemandWaits_ZoneResolution
    CHECK (zone_resolution IN ('assigned', 'missing_pickup_coordinate', 'outside_operational_zones', 'ambiguous_operational_zones', 'legacy_unknown'));
GO

CREATE INDEX IX_MonitoredOnDemandWaits_Active
    ON dbo.MonitoredOnDemandWaits (monitor_state, last_polled_at DESC);
GO

-- Append-only commitment evidence keeps the original and later scheduled
-- pickup commitments reviewable without retaining rider or pickup details.
CREATE TABLE dbo.OnDemandRequestCommitmentAudit (
    id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    request_id NVARCHAR(100) NOT NULL,
    source_updated_at DATETIME2 NOT NULL,
    initial_scheduled_pickup_at DATETIME2 NULL,
    scheduled_pickup_at DATETIME2 NOT NULL,
    recorded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_OnDemandRequestCommitmentAudit_Source UNIQUE (request_id, source_updated_at)
);
GO

CREATE TABLE dbo.OnDemandSpareDuties (
    duty_id NVARCHAR(100) NOT NULL PRIMARY KEY,
    vehicle_id NVARCHAR(100) NULL,
    vehicle_source_updated_at DATETIME2 NULL,
    is_matching_enabled BIT NULL,
    matching_updated_at DATETIME2 NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

PRINT 'Migration 081 applied: live on-demand risk monitor state and commitment audit created.';
