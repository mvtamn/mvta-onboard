-- Preserve cooldown reservations by detected time so delayed queue messages
-- are suppressed only when they are actually within the 60-second window.
IF COL_LENGTH('dbo.EventGeofenceNotificationCooldowns', 'crossed_at') IS NULL
BEGIN
  ALTER TABLE dbo.EventGeofenceNotificationCooldowns ADD crossed_at DATETIME2 NULL;
  UPDATE dbo.EventGeofenceNotificationCooldowns SET crossed_at=last_notified_at WHERE crossed_at IS NULL;
  ALTER TABLE dbo.EventGeofenceNotificationCooldowns ALTER COLUMN crossed_at DATETIME2 NOT NULL;
END;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'PK_EventGeofenceNotificationCooldowns')
  ALTER TABLE dbo.EventGeofenceNotificationCooldowns DROP CONSTRAINT PK_EventGeofenceNotificationCooldowns;
GO

IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'PK_EventGeofenceNotificationCooldowns')
  ALTER TABLE dbo.EventGeofenceNotificationCooldowns
    ADD CONSTRAINT PK_EventGeofenceNotificationCooldowns
      PRIMARY KEY (vehicle_id, service_plan_id, geofence_id, transition, crossed_at);
GO

PRINT 'Migration 070 applied: Event AVL cooldown reservations retain their detected timeline.';
