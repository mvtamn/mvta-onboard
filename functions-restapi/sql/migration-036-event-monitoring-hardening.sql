-- Separate shared AVL ingestion cadence from event projection/detection and
-- add the state needed for safe event processing and notification retries.

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE module = 'avail' AND setting_key = 'poll_interval_seconds')
  INSERT INTO AppSettings(module, setting_key, setting_value, value_type, min_value, max_value, description)
  VALUES ('avail', 'poll_interval_seconds', '30', 'int', '15', '300',
          'How often shared Avail AVL data is fetched for all consumers.');
GO

IF NOT EXISTS (SELECT 1 FROM AppPollState WHERE module = 'avail')
  INSERT INTO AppPollState(module, last_run_at) VALUES ('avail', NULL);
GO

IF COL_LENGTH('dbo.EventGeofenceVehicleState', 'pending_is_inside') IS NULL
  ALTER TABLE EventGeofenceVehicleState ADD pending_is_inside BIT NULL;
GO
IF COL_LENGTH('dbo.EventGeofenceVehicleState', 'pending_confirmations') IS NULL
  ALTER TABLE EventGeofenceVehicleState ADD pending_confirmations INT NOT NULL CONSTRAINT DF_EventGeofenceVehicleState_PendingConfirmations DEFAULT 0;
GO
IF COL_LENGTH('dbo.EventGeofenceVehicleState', 'last_report_timestamp') IS NULL
  ALTER TABLE EventGeofenceVehicleState ADD last_report_timestamp DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.EventGeofenceNotifications', 'attempt_count') IS NULL
  ALTER TABLE EventGeofenceNotifications ADD attempt_count INT NOT NULL CONSTRAINT DF_EventGeofenceNotifications_AttemptCount DEFAULT 0;
GO
IF COL_LENGTH('dbo.EventGeofenceNotifications', 'last_error') IS NULL
  ALTER TABLE EventGeofenceNotifications ADD last_error NVARCHAR(500) NULL;
GO
IF COL_LENGTH('dbo.EventGeofenceNotifications', 'next_attempt_at') IS NULL
  ALTER TABLE EventGeofenceNotifications ADD next_attempt_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_EventGeofenceNotifications_Crossing' AND object_id = OBJECT_ID('dbo.EventGeofenceNotifications'))
  CREATE UNIQUE INDEX UX_EventGeofenceNotifications_Crossing ON EventGeofenceNotifications(crossing_id);
GO

IF OBJECT_ID('dbo.CK_EventGeofenceNotifications_Status', 'C') IS NOT NULL
  ALTER TABLE EventGeofenceNotifications DROP CONSTRAINT CK_EventGeofenceNotifications_Status;
GO
ALTER TABLE EventGeofenceNotifications ADD CONSTRAINT CK_EventGeofenceNotifications_Status
  CHECK (status IN ('pending','sent','dismissed','failed','expired'));
GO

PRINT 'Migration 036 applied: shared/event cadence separation and event processing hardening added.';
