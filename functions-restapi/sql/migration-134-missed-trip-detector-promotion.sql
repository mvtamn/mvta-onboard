-- Migration 134: the missed-trip detector promotion history.
--
-- Promotion out of Shadow detection was MISSED_TRIP_PROMOTED_DETECTORS, an app
-- setting: a list of detector names with no date, no reason and no author.
-- Changing it promoted a detector for all of history, so a month already
-- assessed gained missed trips retroactively; nothing recorded who decided or
-- on what evidence; and SQL could not read it, so vw_MissedTrip had to report
-- every detector as unpromoted and disagreed with the app.
--
-- 1. MissedTripDetectorPromotions: an append-only history of promote and demote
--    decisions. Each is effective from a SERVICE date, carries the measured
--    precision and sample size it was decided on, a reason, and the person who
--    decided. The latest decision at or before a case's service date is the
--    one that applies, so promoting today never rewrites last month and
--    demoting a detector leaves the months it was trusted for alone.
-- 2. The view is NOT redefined here. Migrations are append-only and migration
--    135 is the current definer of vw_MissedTrip, so migration 137 redefines it
--    to read this history - after 135, whichever order these are applied in.
--
-- Nothing is promoted by this migration. The table starts empty, which is
-- exactly what the setting said on dev, so no figure moves when it is applied.
--
-- Re-runnable: the table is created only when missing, and the view is
-- CREATE OR ALTER. Apply it before deploying the code that reads the history.

IF OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL
  THROW 50134, 'Migration 134 requires MonitoredMissedTrips (migration 011) and vw_MissedTrip (migration 125).', 1;
GO

IF OBJECT_ID('dbo.MissedTripDetectorPromotions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.MissedTripDetectorPromotions (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_MissedTripDetectorPromotions PRIMARY KEY DEFAULT NEWID(),
    -- Detector family, not detector version: a new version of a promoted
    -- detector stays promoted (CONTEXT: Shadow detection).
    detector NVARCHAR(40) NOT NULL,
    -- Service date key (YYYYMMDD) the decision takes effect from.
    effective_service_date CHAR(8) NOT NULL,
    promoted BIT NOT NULL,
    reason NVARCHAR(1000) NOT NULL,
    -- The evidence the decision was made on, as measured at the time.
    measured_precision DECIMAL(5,4) NULL,
    sample_size INT NULL,
    decided_by NVARCHAR(200) NOT NULL,
    decided_at DATETIME2 NOT NULL CONSTRAINT DF_MissedTripDetectorPromotions_decided_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_MissedTripDetectorPromotions_detector
      CHECK (detector IN (N'gtfs_cancellation', N'gtfs_silent_no_show', N'spare')),
    CONSTRAINT CK_MissedTripDetectorPromotions_effective
      CHECK (effective_service_date LIKE N'[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')
  );
  CREATE INDEX IX_MissedTripDetectorPromotions_detector
    ON dbo.MissedTripDetectorPromotions (detector, effective_service_date, decided_at);
END
GO

PRINT 'Migration 134 applied: missed-trip detector promotion history. Migration 137 points vw_MissedTrip at it.';
