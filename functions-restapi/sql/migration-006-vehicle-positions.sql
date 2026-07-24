-- Migration 006: add live position/occupancy columns to MonitoredTripDelays
-- (GTFS-Realtime VehiclePosition, Phase 3 of 3 - completes the three
-- official GTFS-RT feed types: Alert [migration-004], TripUpdate
-- [migration-005], VehiclePosition [this one]).
--
-- Reuses MonitoredTripDelays rather than a new table: VehiclePosition
-- entities carry the same Trip.TripId/RouteId and Vehicle.Id that TripUpdate
-- already does, and both feeds cover the identical set of currently-active
-- trips, so there's no real "different lifecycle" problem to justify a
-- second table. gtfsVehiclePositionsPoll.ts only UPDATEs these columns
-- (never inserts) - if a position update arrives before TripUpdate has
-- created the row, it's skipped rather than inserting a row with a
-- misleading default delay_seconds.
--
-- Run once against the live database (private endpoint - see HANDOFF §5.7
-- for the temporary-public-access procedure).

ALTER TABLE MonitoredTripDelays ADD
    latitude            FLOAT     NULL,
    longitude           FLOAT     NULL,
    bearing             FLOAT     NULL,
    speed_mps           FLOAT     NULL,
    occupancy_status    INT       NULL,
    current_status      INT       NULL,
    position_updated_at DATETIME2 NULL;
GO

PRINT 'Migration 006 applied: MonitoredTripDelays position/occupancy columns added.';
