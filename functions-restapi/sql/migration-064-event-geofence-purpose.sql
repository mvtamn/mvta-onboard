-- Requires migration 033 (EventGeofences). COL_LENGTH returns NULL for a
-- missing table exactly as it does for a missing column, so guarding on it
-- alone let this script attempt the ALTERs against a table that was not there
-- and still print success. Check the object first and stop with a message
-- naming the prerequisite.
IF OBJECT_ID('dbo.EventGeofences', 'U') IS NULL
  THROW 50064, 'Migration 064 skipped: dbo.EventGeofences does not exist. Apply migration 033 first, and confirm its tables were created in the dbo schema (033 creates them unqualified, so they land in the executing user''s default schema).', 1;
GO

IF COL_LENGTH('dbo.EventGeofences', 'purpose') IS NULL
BEGIN
  ALTER TABLE dbo.EventGeofences
    ADD purpose NVARCHAR(20) NOT NULL
      CONSTRAINT DF_EventGeofences_Purpose DEFAULT 'other';
END;
GO

-- Separate batch: SQL Server compiles a whole batch before running any of it,
-- so a CHECK referencing `purpose` in the same batch that adds the column
-- fails to bind with "Invalid column name 'purpose'" - the column does not
-- exist yet at compile time, only at run time.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EventGeofences_Purpose')
BEGIN
  ALTER TABLE dbo.EventGeofences
    ADD CONSTRAINT CK_EventGeofences_Purpose
      CHECK (purpose IN ('staging', 'corridor', 'venue', 'other'));
END;
GO

-- Only claim success once the column is actually present.
IF COL_LENGTH('dbo.EventGeofences', 'purpose') IS NOT NULL
  PRINT 'Migration 064 applied: Event geofence purpose added.';
ELSE
  PRINT 'Migration 064 did NOT apply: dbo.EventGeofences.purpose is still missing.';
GO
