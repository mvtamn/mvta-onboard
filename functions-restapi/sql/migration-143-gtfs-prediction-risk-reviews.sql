-- Migration 143: keep the schedule's prediction-risk review from each static
-- GTFS sync.
--
-- The daily static sync (gtfsStopsSync.ts) now runs lib/gtfsPredictionRisk.ts
-- over the feed it imports: per route, the parts of the published schedule
-- that make arrival predictions worse (placeholder stop times, long gaps
-- between timepoints, stop-free freeway miles, tight turnarounds, buses coming
-- off another route, impossible blocks, run-time spread). Integrations & Data
-- Health shows the latest one.
--
-- One row per sync, not per route: the checks are expected to change as
-- OnBoard starts measuring prediction accuracy itself, and a JSON document
-- lets a new check land without a migration. Rows are kept so the review can
-- be compared across feed versions; at roughly 10 KB a day there is nothing
-- to prune.
--
-- Until this is applied the sync skips storing the review (and says so in its
-- log) and the page says the migration is missing; the import itself is
-- unaffected.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.GtfsPredictionRiskReviews', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GtfsPredictionRiskReviews (
    review_id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_GtfsPredictionRiskReviews PRIMARY KEY,
    reviewed_at DATETIME2 NOT NULL CONSTRAINT DF_GtfsPredictionRiskReviews_reviewed_at DEFAULT SYSUTCDATETIME(),
    feed_version NVARCHAR(100) NULL,
    route_count INT NOT NULL,
    flagged_route_count INT NOT NULL,
    review_json NVARCHAR(MAX) NOT NULL
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GtfsPredictionRiskReviews_reviewed_at')
  CREATE INDEX IX_GtfsPredictionRiskReviews_reviewed_at
    ON dbo.GtfsPredictionRiskReviews (reviewed_at DESC);
GO
