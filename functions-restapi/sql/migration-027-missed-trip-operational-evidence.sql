-- Migration 027: schedule-start reference fields and positive operational
-- evidence for the Missed Trips detector. Feed presence is not a departure;
-- first_underway_at is set only when VehiclePosition progresses beyond the
-- static trip's first stop sequence.

-- Repair the static-schedule prerequisites as well. A few databases reached
-- migration 011 only partially, so these tables cannot be assumed to exist.
IF OBJECT_ID(N'dbo.GtfsCalendar', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.GtfsCalendar (
        service_id NVARCHAR(50) NOT NULL PRIMARY KEY,
        monday     BIT          NOT NULL,
        tuesday    BIT          NOT NULL,
        wednesday  BIT          NOT NULL,
        thursday   BIT          NOT NULL,
        friday     BIT          NOT NULL,
        saturday   BIT          NOT NULL,
        sunday     BIT          NOT NULL,
        start_date CHAR(8)      NOT NULL,
        end_date   CHAR(8)      NOT NULL,
        updated_at DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.GtfsCalendarDates', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.GtfsCalendarDates (
        service_id     NVARCHAR(50) NOT NULL,
        service_date   CHAR(8)      NOT NULL,
        exception_type INT          NOT NULL,
        updated_at     DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_GtfsCalendarDates PRIMARY KEY (service_id, service_date),
        CONSTRAINT CK_GtfsCalendarDates_ExceptionType CHECK (exception_type IN (1, 2))
    );
END;
GO

-- Some environments have a partial migration-011 state. Create the complete
-- current schedule table when it is absent; otherwise upgrade it in place.
IF OBJECT_ID(N'dbo.GtfsScheduledTrips', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.GtfsScheduledTrips (
        trip_id                  NVARCHAR(100) NOT NULL PRIMARY KEY,
        route_id                 NVARCHAR(50)  NOT NULL,
        service_id               NVARCHAR(50)  NOT NULL,
        first_departure_seconds  INT           NOT NULL,
        first_stop_id            NVARCHAR(100) NULL,
        first_stop_sequence      INT           NULL,
        block_id                 NVARCHAR(100) NULL,
        updated_at               DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
ELSE
BEGIN
    IF COL_LENGTH('dbo.GtfsScheduledTrips', 'first_stop_id') IS NULL
        ALTER TABLE dbo.GtfsScheduledTrips ADD first_stop_id NVARCHAR(100) NULL;

    IF COL_LENGTH('dbo.GtfsScheduledTrips', 'first_stop_sequence') IS NULL
        ALTER TABLE dbo.GtfsScheduledTrips ADD first_stop_sequence INT NULL;

    IF COL_LENGTH('dbo.GtfsScheduledTrips', 'block_id') IS NULL
        ALTER TABLE dbo.GtfsScheduledTrips ADD block_id NVARCHAR(100) NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.GtfsScheduledTrips')
      AND name = N'IX_GtfsScheduledTrips_ServiceId'
)
    CREATE INDEX IX_GtfsScheduledTrips_ServiceId
        ON dbo.GtfsScheduledTrips (service_id);
GO

IF OBJECT_ID(N'dbo.GtfsTripOperationalEvidence', N'U') IS NULL
BEGIN
CREATE TABLE dbo.GtfsTripOperationalEvidence (
    trip_id                   NVARCHAR(100) NOT NULL,
    service_date              NVARCHAR(20)  NOT NULL,
    route_id                  NVARCHAR(50)  NULL,
    vehicle_id                NVARCHAR(100) NULL,
    first_trip_update_at      DATETIME2     NULL,
    last_trip_update_at       DATETIME2     NULL,
    first_vehicle_position_at DATETIME2     NULL,
    last_vehicle_position_at  DATETIME2     NULL,
    first_underway_at         DATETIME2     NULL,
    current_stop_sequence     INT           NULL,
    current_stop_id           NVARCHAR(100) NULL,
    current_status            INT           NULL,
    source_timestamp_at       DATETIME2     NULL,
    updated_at                DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_GtfsTripOperationalEvidence PRIMARY KEY (trip_id, service_date)
);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.GtfsTripOperationalEvidence')
      AND name = N'IX_GtfsTripOperationalEvidence_Underway'
)
    CREATE INDEX IX_GtfsTripOperationalEvidence_Underway
        ON dbo.GtfsTripOperationalEvidence (service_date, first_underway_at);
GO

IF OBJECT_ID(N'dbo.MissedTripFeedHealth', N'U') IS NULL
BEGIN
CREATE TABLE dbo.MissedTripFeedHealth (
    feed_name           NVARCHAR(50) NOT NULL PRIMARY KEY,
    last_success_at     DATETIME2    NULL,
    last_entity_count   INT          NULL,
    source_timestamp_at DATETIME2    NULL,
    updated_at          DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
);
END;
GO

PRINT 'Migration 027 verified: GTFS trip-start schedule fields, operational evidence, and feed health are present.';
