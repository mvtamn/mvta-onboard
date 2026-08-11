-- Separate operator acknowledgement from successful external delivery.
IF COL_LENGTH('dbo.EventGeofenceNotifications', 'acknowledged_by') IS NULL
  ALTER TABLE EventGeofenceNotifications ADD acknowledged_by NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.EventGeofenceNotifications', 'acknowledged_at') IS NULL
  ALTER TABLE EventGeofenceNotifications ADD acknowledged_at DATETIME2 NULL;
IF OBJECT_ID('dbo.CK_EventGeofenceNotifications_Status', 'C') IS NOT NULL
  ALTER TABLE EventGeofenceNotifications DROP CONSTRAINT CK_EventGeofenceNotifications_Status;
ALTER TABLE EventGeofenceNotifications ADD CONSTRAINT CK_EventGeofenceNotifications_Status CHECK (status IN ('pending','acknowledged','sent','dismissed','failed','expired'));
GO
PRINT 'Migration 044 applied: Event notification acknowledgement state added.';
