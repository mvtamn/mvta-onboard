-- Migration 007: trip direction labels + previous-stop tracking.
--
-- GtfsTripDirections is a small reference table, populated by a daily
-- static-GTFS sync (gtfsStopsSync.ts), used to resolve a trip's route
-- direction (NB/SB/EB/WB) - GTFS-Realtime has no direction field at all,
-- so this must come from the static schedule's trips.txt (trip_headsign +
-- direction_id), joined by trip_id.
--
-- previous_stop_id on MonitoredTripDelays tracks the stop a trip most
-- recently advanced past. Neither realtime feed exposes this directly
-- (TripUpdate only lists upcoming stops) - gtfsDelaysPoll.ts derives it
-- itself by shifting the old next_stop_id into this column whenever the
-- next_stop_id changes between polls.
--
-- Run once against the live database (private endpoint - see HANDOFF §5.7
-- for the temporary-public-access procedure).

ALTER TABLE MonitoredTripDelays ADD previous_stop_id NVARCHAR(50) NULL;
GO

CREATE TABLE GtfsTripDirections (
    trip_id         NVARCHAR(100) NOT NULL PRIMARY KEY,
    route_id        NVARCHAR(50)  NOT NULL,
    direction_id    INT           NOT NULL,
    trip_headsign   NVARCHAR(200) NULL,
    direction_label NVARCHAR(10)  NULL,  -- NB | SB | EB | WB | NULL if undeterminable
    updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

PRINT 'Migration 007 applied: GtfsTripDirections created, MonitoredTripDelays.previous_stop_id added.';
