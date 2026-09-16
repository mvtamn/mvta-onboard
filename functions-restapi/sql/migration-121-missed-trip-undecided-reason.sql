-- Migration 121: say WHY a silent-no-show row is not yet a finding.
--
-- Migration 087 gave the fixed-route detector one way to say "undecidable":
-- data_quality_status = 'unknown_data_gap'. One value cannot distinguish the
-- reasons, and the reasons need different remedies - a stale static import is
-- fixed by re-running the GTFS sync, a dead AVL unit by a garage, a pending
-- confirmation by waiting five minutes. Without the reason a reviewer sees an
-- undifferentiated pile and the operator has nothing to act on.
--
-- Values written by gtfsMissedTripsPoll.ts (see missedTripConfidence.ts, which
-- owns the vocabulary):
--   awaiting_confirmation            - detected once past its deadline; held
--                                      until a second poll agrees. Carries
--                                      data_quality_status 'experimental'.
--   vehicle_position_feed_not_current- gtfs_vehicle_positions was not current,
--                                      so absence proves nothing.
--   static_schedule_stale            - the static GTFS import is too old to
--                                      describe today's service.
--   schedule_disagrees_with_feed     - almost none of the day's past-deadline
--                                      scheduled trips were known to either
--                                      realtime feed: a schedule mismatch, not
--                                      a day of missed trips.
--   block_never_reported             - no vehicle position arrived for ANY trip
--                                      on this trip's block all day, so this
--                                      block's silence is the vehicle's, not
--                                      the trip's.
-- A row with undecided_reason IS NOT NULL is not a finding: the review queue
-- and its tiles exclude it, and nothing promotes it into compliance until the
-- detector clears the reason.

IF COL_LENGTH(N'dbo.MonitoredMissedTrips', N'undecided_reason') IS NULL
    ALTER TABLE dbo.MonitoredMissedTrips ADD undecided_reason NVARCHAR(60) NULL;
GO

-- The confirmation pass looks up held rows by reason and age every five
-- minutes; the queue filter reads the same column on every request.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.MonitoredMissedTrips')
      AND name = N'IX_MonitoredMissedTrips_Undecided'
)
    CREATE INDEX IX_MonitoredMissedTrips_Undecided
        ON dbo.MonitoredMissedTrips (undecided_reason, first_seen_watching_at)
        WHERE undecided_reason IS NOT NULL;
GO

PRINT 'Migration 121 applied: MonitoredMissedTrips.undecided_reason added.';
