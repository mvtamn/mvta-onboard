-- Migration 005: TripUpdate-based delay detection (Phase 2 of GTFS-Realtime
-- integration; Phase 1 was the Alert-feed CAD bridge in migration-004).
--
-- MonitoredTripDelays tracks every currently-active trip's latest known
-- delay. It doubles as: (a) the hysteresis counter deciding when a sustained
-- delay escalates into a SuggestedAlerts rider-alert candidate, and (b) the
-- backing data for the console's Live Delays view. A durable table is
-- required rather than in-process memory, since Azure Functions
-- Consumption-plan instances aren't guaranteed to persist state between
-- invocations.
--
-- GtfsStops is a small reference table populated by a daily static-GTFS
-- sync, used to resolve TripUpdate's opaque internal stop IDs into real stop
-- names for readable rider-facing alert text.
--
-- Run once against the live database (private endpoint - see HANDOFF §5.7
-- for the temporary-public-access procedure). GO separates batches.

CREATE TABLE MonitoredTripDelays (
    trip_id              NVARCHAR(100)    NOT NULL PRIMARY KEY,
    route_id             NVARCHAR(50)     NOT NULL,
    vehicle_id           NVARCHAR(50)     NULL,
    next_stop_id         NVARCHAR(50)     NULL,
    delay_seconds        INT              NOT NULL,
    polls_over_threshold INT              NOT NULL DEFAULT 0,
    first_seen_at        DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    last_polled_at       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    suggested_alert_id   UNIQUEIDENTIFIER NULL REFERENCES SuggestedAlerts(alert_id)
);
GO

CREATE INDEX IX_MonitoredTripDelays_LastPolled ON MonitoredTripDelays (last_polled_at);
GO

CREATE TABLE GtfsStops (
    stop_id    NVARCHAR(50)  NOT NULL PRIMARY KEY,
    stop_name  NVARCHAR(200) NOT NULL,
    stop_lat   FLOAT         NULL,
    stop_lon   FLOAT         NULL,
    updated_at DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

PRINT 'Migration 005 applied: MonitoredTripDelays and GtfsStops created.';
