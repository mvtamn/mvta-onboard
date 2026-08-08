-- Migration 029: Connect the bounded Spare Requests + Slots pipeline to the
-- shared Missed Trips review queue. Safe to rerun after a partial execution.

IF COL_LENGTH(N'dbo.SpareMissedTripSlots', N'status') IS NULL
    ALTER TABLE dbo.SpareMissedTripSlots ADD status NVARCHAR(32) NULL;
GO

IF COL_LENGTH(N'dbo.SpareMissedTripSlots', N'cancelled_at') IS NULL
    ALTER TABLE dbo.SpareMissedTripSlots ADD cancelled_at DATETIME2 NULL;
GO

IF COL_LENGTH(N'dbo.SpareMissedTripSlots', N'source_updated_at') IS NULL
    ALTER TABLE dbo.SpareMissedTripSlots ADD source_updated_at DATETIME2 NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.SpareMissedTripSlots')
      AND name = N'IX_SpareMissedTripSlots_Request'
)
    CREATE INDEX IX_SpareMissedTripSlots_Request
        ON dbo.SpareMissedTripSlots (request_id, slot_type, scheduled_at);
GO

IF COL_LENGTH(N'dbo.MonitoredMissedTrips', N'source_system') IS NULL
BEGIN
    ALTER TABLE dbo.MonitoredMissedTrips ADD source_system NVARCHAR(20) NULL;
    UPDATE dbo.MonitoredMissedTrips SET source_system = N'gtfs' WHERE source_system IS NULL;
    ALTER TABLE dbo.MonitoredMissedTrips ALTER COLUMN source_system NVARCHAR(20) NOT NULL;
    ALTER TABLE dbo.MonitoredMissedTrips ADD CONSTRAINT DF_MonitoredMissedTrips_SourceSystem DEFAULT N'gtfs' FOR source_system;
END;
GO

IF COL_LENGTH(N'dbo.MonitoredMissedTrips', N'source_record_id') IS NULL
    ALTER TABLE dbo.MonitoredMissedTrips ADD source_record_id NVARCHAR(100) NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.MonitoredMissedTrips')
      AND parent_column_id = COLUMNPROPERTY(OBJECT_ID(N'dbo.MonitoredMissedTrips'), N'source_system', 'ColumnId')
)
    ALTER TABLE dbo.MonitoredMissedTrips ADD CONSTRAINT DF_MonitoredMissedTrips_SourceSystem DEFAULT N'gtfs' FOR source_system;
GO

IF COL_LENGTH(N'dbo.MonitoredMissedTrips', N'evidence_json') IS NULL
    ALTER TABLE dbo.MonitoredMissedTrips ADD evidence_json NVARCHAR(MAX) NULL;
GO

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.MonitoredMissedTrips')
      AND name = N'CK_MonitoredMissedTrips_DetectionType'
)
    ALTER TABLE dbo.MonitoredMissedTrips DROP CONSTRAINT CK_MonitoredMissedTrips_DetectionType;
GO

ALTER TABLE dbo.MonitoredMissedTrips ADD CONSTRAINT CK_MonitoredMissedTrips_DetectionType
    CHECK (detection_type IN (
        'explicit_cancellation', 'silent_no_show',
        'spare_late_start', 'spare_superseded', 'spare_late_arrival', 'spare_multiple'
    ) OR detection_type IS NULL);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.MonitoredMissedTrips')
      AND name = N'CK_MonitoredMissedTrips_SourceSystem'
)
    ALTER TABLE dbo.MonitoredMissedTrips ADD CONSTRAINT CK_MonitoredMissedTrips_SourceSystem
        CHECK (source_system IN ('gtfs', 'spare'));
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.MonitoredMissedTrips')
      AND name = N'IX_MonitoredMissedTrips_SourceRecord'
)
    CREATE INDEX IX_MonitoredMissedTrips_SourceRecord
        ON dbo.MonitoredMissedTrips (source_system, source_record_id);
GO

PRINT 'Migration 029 verified: Spare ingestion fields and shared Missed Trips source evidence are present.';
