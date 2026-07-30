-- Migration 012: Avail360 AVL Reports ingestion.
--
-- This is a genuinely separate data source from the GTFS-Realtime feeds
-- already ingested (gtfsDelaysPoll.ts, gtfsVehiclePositionsPoll.ts, etc.) -
-- it's Avail's own proprietary AVL Reports API (https://avail360-api.myavail
-- .cloud/AVLReports/v1/MVTA/{date}), keyed by Avail's numeric Vehicle/Block/
-- Run/Trip IDs, with no guaranteed 1:1 join to a GTFS trip_id. Per the same
-- reasoning migration-006's header documents for why VehiclePosition COULD
-- reuse MonitoredTripDelays (identical trip_id/route_id keys) - this data
-- does NOT share those keys, so it gets its own table rather than being
-- bolted onto an existing one.
--
-- One row per vehicle (its most recent report) - availAvlPoll.ts upserts by
-- vehicle_id every 5 minutes, matching the "latest known position" nature of
-- AVL tracking rather than keeping a full history.
--
-- Run once against the live database (private endpoint - see HANDOFF §5.7
-- for the temporary-public-access procedure).

CREATE TABLE AvailAvlVehiclePositions (
    vehicle_id       INT           NOT NULL PRIMARY KEY,
    route            INT           NULL,
    block            INT           NULL,
    run              INT           NULL,
    trip             INT           NULL,
    latitude         FLOAT         NOT NULL,
    longitude        FLOAT         NOT NULL,
    heading          FLOAT         NULL,
    direction        NVARCHAR(5)   NULL, -- Avail's raw direction code, e.g. 'O'/'I'
    report_timestamp DATETIME2     NOT NULL, -- the AVL report's own Timestamp field
    updated_at        DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE INDEX IX_AvailAvlVehiclePositions_Route ON AvailAvlVehiclePositions (route);
GO

PRINT 'Migration 012 applied: AvailAvlVehiclePositions created.';
