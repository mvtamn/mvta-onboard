SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH('dbo.EventGeofenceCrossings', 'route_id') IS NULL
    ALTER TABLE dbo.EventGeofenceCrossings ADD route_id INT NULL;

COMMIT TRANSACTION;
GO
PRINT 'Migration 055 applied: event crossings retain the AVL route at crossing time.';
