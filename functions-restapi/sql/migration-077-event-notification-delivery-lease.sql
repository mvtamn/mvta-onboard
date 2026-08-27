-- A delivery lease prevents concurrent queue workers or operators from posting
-- the same Event notification to Teams at the same time.
IF COL_LENGTH('dbo.EventGeofenceNotifications', 'delivery_claim_token') IS NULL
  ALTER TABLE EventGeofenceNotifications ADD delivery_claim_token UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('dbo.EventGeofenceNotifications', 'delivery_claimed_at') IS NULL
  ALTER TABLE EventGeofenceNotifications ADD delivery_claimed_at DATETIME2 NULL;
GO
IF OBJECT_ID('dbo.CK_EventGeofenceNotifications_Status', 'C') IS NOT NULL
  ALTER TABLE EventGeofenceNotifications DROP CONSTRAINT CK_EventGeofenceNotifications_Status;
GO
ALTER TABLE EventGeofenceNotifications ADD CONSTRAINT CK_EventGeofenceNotifications_Status
  CHECK (status IN ('pending','acknowledged','sending','sent','dismissed','failed','expired'));
GO
PRINT 'Migration 077 applied: Event notification delivery leases added.';
