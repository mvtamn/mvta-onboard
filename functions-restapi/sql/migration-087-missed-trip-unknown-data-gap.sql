-- Migration 087: allow the silent-no-show detector to record an undecidable
-- trip as a data gap instead of a missed trip.
--
-- The fixed-route detector declares a scheduled trip missed when no positive
-- vehicle-start evidence exists by its grace deadline. Absent evidence and
-- UNAVAILABLE evidence were the same branch: while gtfs_vehicle_positions was
-- stale or down, every scheduled trip in the window read as a silent no-show.
--
-- plans/missed-trip-feature-finish-plan.md has always required the opposite -
-- "a feed outage produces unknown_data_gap, not candidate" - and the Spare
-- evaluator implements it (migration-028's decision_state). This gives the
-- fixed-route path the same vocabulary so the two detectors can agree about
-- what an outage means.

ALTER TABLE MonitoredMissedTrips DROP CONSTRAINT CK_MonitoredMissedTrips_DataQuality;
GO

ALTER TABLE MonitoredMissedTrips ADD CONSTRAINT CK_MonitoredMissedTrips_DataQuality
    CHECK (data_quality_status IN ('legacy_unverified', 'source_verified', 'experimental', 'unknown_data_gap'));
GO

PRINT 'Migration 087 applied: MonitoredMissedTrips.data_quality_status accepts unknown_data_gap.';
