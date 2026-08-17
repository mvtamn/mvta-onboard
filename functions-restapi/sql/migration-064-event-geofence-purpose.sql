IF COL_LENGTH('dbo.EventGeofences', 'purpose') IS NULL
BEGIN
  ALTER TABLE dbo.EventGeofences
    ADD purpose NVARCHAR(20) NOT NULL
      CONSTRAINT DF_EventGeofences_Purpose DEFAULT 'other';
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EventGeofences_Purpose')
BEGIN
  ALTER TABLE dbo.EventGeofences
    ADD CONSTRAINT CK_EventGeofences_Purpose
      CHECK (purpose IN ('staging', 'corridor', 'venue', 'other'));
END;

PRINT 'Migration 064 applied: Event geofence purpose added.';
