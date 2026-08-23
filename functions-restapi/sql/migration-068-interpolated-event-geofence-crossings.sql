-- Keep the evidence behind both confirmed-point and interpolated path movements.
IF COL_LENGTH('dbo.EventGeofenceCrossings', 'detection_method') IS NULL
  ALTER TABLE dbo.EventGeofenceCrossings
    ADD detection_method NVARCHAR(30) NOT NULL
      CONSTRAINT DF_EventGeofenceCrossings_DetectionMethod DEFAULT 'point_confirmed';
GO

IF COL_LENGTH('dbo.EventGeofenceCrossings', 'source_report_from_at') IS NULL
  ALTER TABLE dbo.EventGeofenceCrossings ADD source_report_from_at DATETIME2 NULL;
IF COL_LENGTH('dbo.EventGeofenceCrossings', 'source_report_to_at') IS NULL
  ALTER TABLE dbo.EventGeofenceCrossings ADD source_report_to_at DATETIME2 NULL;
IF COL_LENGTH('dbo.EventGeofenceCrossings', 'source_displacement_meters') IS NULL
  ALTER TABLE dbo.EventGeofenceCrossings ADD source_displacement_meters DECIMAL(10,1) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EventGeofenceCrossings_DetectionMethod')
  ALTER TABLE dbo.EventGeofenceCrossings
    ADD CONSTRAINT CK_EventGeofenceCrossings_DetectionMethod
      CHECK (detection_method IN ('point_confirmed','path_interpolated'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EventGeofenceCrossings_MovementCooldown' AND object_id = OBJECT_ID('dbo.EventGeofenceCrossings'))
  CREATE INDEX IX_EventGeofenceCrossings_MovementCooldown
    ON dbo.EventGeofenceCrossings(vehicle_id, service_plan_id, geofence_id, transition, crossed_at DESC);
GO

PRINT 'Migration 068 applied: Event AVL crossing evidence supports qualified GPS paths.';
