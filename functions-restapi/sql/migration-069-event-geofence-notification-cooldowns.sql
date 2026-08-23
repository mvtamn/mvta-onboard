-- Serialize the 60-second notification cooldown across concurrent queue handlers.
IF OBJECT_ID('dbo.EventGeofenceNotificationCooldowns', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EventGeofenceNotificationCooldowns (
    vehicle_id INT NOT NULL,
    service_plan_id UNIQUEIDENTIFIER NOT NULL,
    geofence_id UNIQUEIDENTIFIER NOT NULL,
    transition NVARCHAR(10) NOT NULL,
    last_notified_at DATETIME2 NOT NULL,
    CONSTRAINT PK_EventGeofenceNotificationCooldowns PRIMARY KEY (vehicle_id, service_plan_id, geofence_id, transition),
    CONSTRAINT CK_EventGeofenceNotificationCooldowns_Transition CHECK (transition IN ('enter','exit'))
  );
END;
GO

PRINT 'Migration 069 applied: Event AVL notification cooldowns are serialized.';
