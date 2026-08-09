-- Event monitoring geofences, locations, crossings, and notification review queue.
CREATE TABLE EventGeofences (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    polygon NVARCHAR(MAX) NOT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    updated_by NVARCHAR(200) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE EventLocations (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    name NVARCHAR(150) NOT NULL,
    category NVARCHAR(20) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    notes NVARCHAR(500) NULL,
    is_active BIT NOT NULL DEFAULT 1,
    updated_by NVARCHAR(200) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventLocations_Category CHECK (category IN ('transit_station','venue','park_and_ride','other'))
);
CREATE TABLE EventGeofenceDirectionRules (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    geofence_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventGeofences(id),
    transition NVARCHAR(10) NOT NULL,
    heading_min FLOAT NOT NULL,
    heading_max FLOAT NOT NULL,
    destination_label NVARCHAR(200) NOT NULL,
    destination_location_id UNIQUEIDENTIFIER NULL REFERENCES EventLocations(id),
    send_mode NVARCHAR(10) NOT NULL DEFAULT 'manual',
    sort_order INT NOT NULL DEFAULT 0,
    CONSTRAINT CK_EventGeofenceDirectionRules_Transition CHECK (transition IN ('enter','exit')),
    CONSTRAINT CK_EventGeofenceDirectionRules_Heading CHECK (heading_min >= 0 AND heading_min <= 360 AND heading_max >= 0 AND heading_max <= 360),
    CONSTRAINT CK_EventGeofenceDirectionRules_SendMode CHECK (send_mode IN ('manual','auto'))
);
CREATE TABLE EventGeofenceVehicleState (
    vehicle_id INT NOT NULL,
    geofence_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventGeofences(id),
    is_inside BIT NOT NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (vehicle_id, geofence_id)
);
CREATE TABLE EventGeofenceCrossings (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    vehicle_id INT NOT NULL,
    geofence_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventGeofences(id),
    transition NVARCHAR(10) NOT NULL,
    heading_at_crossing FLOAT NULL,
    destination_label NVARCHAR(200) NULL,
    crossed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventGeofenceCrossings_Transition CHECK (transition IN ('enter','exit'))
);
CREATE INDEX IX_EventGeofenceCrossings_Vehicle ON EventGeofenceCrossings(vehicle_id, crossed_at);
CREATE TABLE EventGeofenceNotifications (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    crossing_id BIGINT NOT NULL REFERENCES EventGeofenceCrossings(id),
    send_mode NVARCHAR(10) NOT NULL,
    message_body NVARCHAR(1000) NOT NULL,
    status NVARCHAR(10) NOT NULL DEFAULT 'pending',
    sent_by NVARCHAR(200) NULL,
    sent_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventGeofenceNotifications_Status CHECK (status IN ('pending','sent','dismissed'))
);
GO
PRINT 'Migration 033 applied: event geofences, locations, crossings, and notifications created.';
