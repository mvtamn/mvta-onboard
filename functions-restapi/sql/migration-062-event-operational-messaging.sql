-- Event operational messaging: planning message types and Event AVL delivery control.
ALTER TABLE dbo.EventGeofenceDirectionRules ALTER COLUMN destination_label NVARCHAR(200) NULL;

IF COL_LENGTH('dbo.EventGeofenceDirectionRules', 'message_type') IS NULL
BEGIN
  ALTER TABLE dbo.EventGeofenceDirectionRules
    ADD message_type NVARCHAR(30) NOT NULL
      CONSTRAINT DF_EventGeofenceDirectionRules_MessageType DEFAULT 'custom';
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EventGeofenceDirectionRules_MessageType')
  ALTER TABLE dbo.EventGeofenceDirectionRules
    ADD CONSTRAINT CK_EventGeofenceDirectionRules_MessageType
      CHECK (message_type IN ('departing','passed','arriving_soon','custom'));
GO

IF COL_LENGTH('dbo.EventGeofenceCrossings', 'service_plan_id') IS NULL
  ALTER TABLE dbo.EventGeofenceCrossings ADD service_plan_id UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('dbo.EventGeofenceCrossings', 'matched_message_type') IS NULL
  ALTER TABLE dbo.EventGeofenceCrossings ADD matched_message_type NVARCHAR(30) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EventGeofenceCrossings_MatchedMessageType')
  ALTER TABLE dbo.EventGeofenceCrossings
    ADD CONSTRAINT CK_EventGeofenceCrossings_MatchedMessageType
      CHECK (matched_message_type IS NULL OR matched_message_type IN ('departing','passed','arriving_soon','custom'));
GO

IF OBJECT_ID('dbo.EventOperationalMessaging', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EventOperationalMessaging (
    service_plan_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES dbo.EventServicePlans(id),
    automatic_teams_enabled BIT NOT NULL CONSTRAINT DF_EventOperationalMessaging_AutomaticTeams DEFAULT 0,
    updated_by NVARCHAR(200) NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_EventOperationalMessaging_UpdatedAt DEFAULT SYSUTCDATETIME()
  );
END;
GO

PRINT 'Migration 062 applied: standard event messages and Event AVL operational Teams control added.';
