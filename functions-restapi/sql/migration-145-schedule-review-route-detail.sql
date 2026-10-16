-- Migration 145: keep the evidence behind each schedule review, per route, and
-- stamp a review each time a sync finds it unchanged.
--
-- Migration 143 kept one summary row per daily static sync: per route, a
-- value and a flag for each check. v1.5.324 (lib/scheduleReview, ADR 0040)
-- also keeps what the flag was made of - which stop pairs are placeholders,
-- which timepoint pair is the 45-minute gap, which route the bus comes off,
-- the scheduled minutes over each timepoint segment by hour - one JSON row per
-- route per review, so GET /gtfs-prediction-risk/routes/{route_id} reads one
-- route without parsing the whole review.
--
-- confirmed_at: with this applied the sync writes a new review row only when
-- the review changed (new feed, new code). An identical review stamps
-- confirmed_at on the row it already has, so reviewed_at means "first seen"
-- and feed-to-feed history is one row per change rather than one a day.
--
-- Until this is applied the sync stores the summary daily as before, without
-- detail, and the route endpoint answers 503 naming this file. Rows are tiny:
-- about 19 routes x 5-20 KB per feed version.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.GtfsPredictionRiskReviews', 'confirmed_at') IS NULL
  ALTER TABLE dbo.GtfsPredictionRiskReviews ADD confirmed_at DATETIME2 NULL;
GO

IF OBJECT_ID('dbo.GtfsScheduleReviewRoutes', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GtfsScheduleReviewRoutes (
    review_id INT NOT NULL
      CONSTRAINT FK_GtfsScheduleReviewRoutes_Review REFERENCES dbo.GtfsPredictionRiskReviews (review_id),
    route_id NVARCHAR(50) NOT NULL,
    detail_json NVARCHAR(MAX) NOT NULL,
    CONSTRAINT PK_GtfsScheduleReviewRoutes PRIMARY KEY (review_id, route_id)
  );
END
GO

PRINT 'Migration 145 applied: schedule review route detail and confirmed_at.';
GO
