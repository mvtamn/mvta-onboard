-- Temporary, independent verification of Monitoring Area exits through the configured Teams channel.
IF OBJECT_ID('dbo.EventDepotDepartureTests', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EventDepotDepartureTests (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    location_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.EventLocations(id),
    geofence_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.EventGeofences(id),
    is_enabled BIT NOT NULL CONSTRAINT DF_EventDepotDepartureTests_Enabled DEFAULT 1,
    expires_at DATETIME2 NOT NULL,
    created_by NVARCHAR(200) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_EventDepotDepartureTests_CreatedAt DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(200) NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_EventDepotDepartureTests_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UX_EventDepotDepartureTests_LocationGeofence UNIQUE(location_id, geofence_id)
  );
END;
GO

IF OBJECT_ID('dbo.EventDepotDepartureTestVehicleState', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EventDepotDepartureTestVehicleState (
    test_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.EventDepotDepartureTests(id),
    vehicle_id INT NOT NULL,
    is_inside BIT NOT NULL,
    pending_is_inside BIT NULL,
    pending_confirmations INT NOT NULL CONSTRAINT DF_EventDepotDepartureTestVehicleState_Confirmations DEFAULT 0,
    last_report_timestamp DATETIME2 NULL,
    last_notified_at DATETIME2 NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_EventDepotDepartureTestVehicleState_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_EventDepotDepartureTestVehicleState PRIMARY KEY(test_id, vehicle_id)
  );
END;
GO

IF OBJECT_ID('dbo.EventDepotDepartureTestMessages', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EventDepotDepartureTestMessages (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    test_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.EventDepotDepartureTests(id),
    vehicle_id INT NOT NULL,
    route_id INT NULL,
    exited_at DATETIME2 NOT NULL,
    message_body NVARCHAR(1000) NOT NULL,
    status NVARCHAR(12) NOT NULL CONSTRAINT DF_EventDepotDepartureTestMessages_Status DEFAULT 'pending',
    sent_at DATETIME2 NULL,
    attempt_count INT NOT NULL CONSTRAINT DF_EventDepotDepartureTestMessages_Attempts DEFAULT 0,
    last_error NVARCHAR(500) NULL,
    next_attempt_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_EventDepotDepartureTestMessages_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventDepotDepartureTestMessages_Status CHECK (status IN ('pending','sent','failed','expired'))
  );
  CREATE INDEX IX_EventDepotDepartureTestMessages_Pending ON dbo.EventDepotDepartureTestMessages(status, next_attempt_at, created_at);
END;
GO

PRINT 'Migration 071 applied: temporary Monitoring Area test mode.';
