-- Replace the fixed four-value purpose check with a managed catalog. Purpose
-- codes remain stable because they are stored on reusable areas and snapshots.
IF OBJECT_ID('dbo.EventGeofences', 'U') IS NULL
  THROW 50067, 'Migration 067 skipped: dbo.EventGeofences does not exist. Apply migration 033 first.', 1;
GO

IF OBJECT_ID('dbo.EventGeofencePurposes', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EventGeofencePurposes (
    code NVARCHAR(40) NOT NULL PRIMARY KEY,
    label NVARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_system BIT NOT NULL DEFAULT 0,
    CONSTRAINT CK_EventGeofencePurposes_Code CHECK (code LIKE '[a-z]%' AND code NOT LIKE '%[^a-z0-9_]%'),
    CONSTRAINT UQ_EventGeofencePurposes_Label UNIQUE (label)
  );
END;
GO

INSERT INTO dbo.EventGeofencePurposes(code,label,sort_order,is_system)
SELECT seed.code, seed.label, seed.sort_order, 1
FROM (VALUES ('staging','Staging',10),('corridor','Corridor',20),('venue','Venue',30),('other','Other',99)) seed(code,label,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM dbo.EventGeofencePurposes existing WHERE existing.code=seed.code);
GO

DECLARE @legacyConstraint sysname = (SELECT name FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.EventGeofences') AND name='CK_EventGeofences_Purpose');
DECLARE @dropLegacyConstraint nvarchar(1000);
IF @legacyConstraint IS NOT NULL
BEGIN
  SET @dropLegacyConstraint = N'ALTER TABLE dbo.EventGeofences DROP CONSTRAINT ' + QUOTENAME(@legacyConstraint);
  EXEC sys.sp_executesql @dropLegacyConstraint;
END;
GO

PRINT 'Migration 067 applied: Event Area purpose catalog added.';
