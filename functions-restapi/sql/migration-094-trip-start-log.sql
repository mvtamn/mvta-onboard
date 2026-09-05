-- Migration 094: the Dispatch Log's storage (plans/dispatch-log-spec.md §4.1).
--
-- The OCS desk initials each revenue trip's start in a shared workbook. This
-- is the same log as a read model over data OnBoard already collects, plus a
-- separate human layer. Names are TripStart*, not DispatchLog*: "dispatch" in
-- this repo means Teams message delivery (functions-dispatch), and a table
-- called DispatchLogTrips would read as a message-delivery log.
--
-- TripStartLog is one row per (service date, revenue trip), written nightly by
-- tripStartLogMaterialize for today and tomorrow. It is a growing history and
-- is never truncated: gtfsStopsSync replaces GtfsScheduledTrips wholesale each
-- morning, so a past day's log cannot be rebuilt from the schedule tables
-- after a service change - the display fields are snapshots for that reason.
-- The actual_* columns are left null here; a later step fills them from
-- GTFS-RT (spec §5).
--
-- TripStartVerifications is the human observation, kept apart so a poller can
-- never overwrite what a person saw. Nothing writes it yet (spec §8 step 6).

IF OBJECT_ID('dbo.GtfsScheduledTrips', 'U') IS NULL OR COL_LENGTH('dbo.GtfsScheduledTrips', 'block_id') IS NULL
  THROW 50094, 'Migration 094 requires GtfsScheduledTrips with block_id (migration 027).', 1;
GO
IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
  THROW 50094, 'Migration 094 requires AppSettings (migration 032).', 1;
GO

IF OBJECT_ID('dbo.TripStartLog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TripStartLog (
    service_date            CHAR(8)       NOT NULL,  -- YYYYMMDD, agency-local, as FixedRouteDepartures.
                                                     -- GtfsTripOperationalEvidence holds the same value
                                                     -- as NVARCHAR(20): CAST explicitly when joining.
    trip_id                 NVARCHAR(100) NOT NULL,
    block_id                NVARCHAR(100) NULL,
    route_id                NVARCHAR(50)  NOT NULL,
    route_short_name        NVARCHAR(100) NULL,      -- snapshot; survives a service change
    direction_id            INT           NULL,
    direction_label         NVARCHAR(10)  NULL,
    origin_stop_id          NVARCHAR(100) NULL,
    origin_stop_name        NVARCHAR(200) NULL,      -- snapshot
    scheduled_start_seconds INT           NOT NULL,  -- GTFS seconds since service-day midnight; > 86400 allowed
    scheduled_start_at      DATETIME2     NOT NULL,  -- the resolved UTC instant
    in_rotation             BIT           NOT NULL,  -- on this date's verification list; a snapshot,
                                                     -- kept as written once the day exists (spec §4.1)
    rotation_day            NVARCHAR(10)  NULL,      -- the weekday this trip is dealt to this week
    actual_start_at         DATETIME2     NULL,
    actual_start_source     NVARCHAR(20)  NULL,      -- trip_update | vehicle_position | avail
    start_delay_seconds     INT           NULL,
    start_status            NVARCHAR(20)  NULL,      -- on_time | late | missed | canceled | unknown
    materialized_at         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at              DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_TripStartLog PRIMARY KEY (service_date, trip_id),
    CONSTRAINT CK_TripStartLog_Source CHECK (
      actual_start_source IS NULL OR actual_start_source IN ('trip_update', 'vehicle_position', 'avail')
    ),
    CONSTRAINT CK_TripStartLog_Status CHECK (
      start_status IS NULL OR start_status IN ('on_time', 'late', 'missed', 'canceled', 'unknown')
    )
  );
  CREATE INDEX IX_TripStartLog_DateStart ON dbo.TripStartLog (service_date, scheduled_start_seconds);
END;
GO

IF OBJECT_ID('dbo.TripStartVerifications', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TripStartVerifications (
    service_date      CHAR(8)       NOT NULL,
    trip_id           NVARCHAR(100) NOT NULL,
    observation       NVARCHAR(20)  NOT NULL,        -- observed_on_time | observed_left_late | not_observed
    verified_by       NVARCHAR(200) NOT NULL,        -- Entra identity
    verified_initials NVARCHAR(10)  NOT NULL,
    verified_at       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    note              NVARCHAR(500) NULL,
    CONSTRAINT PK_TripStartVerifications PRIMARY KEY (service_date, trip_id),
    CONSTRAINT CK_TripStartVerifications_Observation CHECK (
      observation IN ('observed_on_time', 'observed_left_late', 'not_observed')
    )
  );
END;
GO

-- The rotation anchor is a setting, not a derivation, so a mid-change GTFS
-- republish cannot silently restart the deal. Blank means "not set yet": the
-- materializer seeds it once from the schedule's earliest date and logs that
-- it did, and a new service change is a deliberate edit of this value.
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE module = 'trip_start_log' AND setting_key = 'rotation_anchor_date')
  INSERT INTO dbo.AppSettings (module, setting_key, setting_value, value_type, description)
  VALUES ('trip_start_log', 'rotation_anchor_date', '', 'string',
          'First day (YYYYMMDD) of the current service change. Week 0 of the Dispatch Log verification rotation starts here; set it again at each service change.');
GO

PRINT 'Migration 094 applied: TripStartLog, TripStartVerifications, and the rotation anchor setting are present.';
