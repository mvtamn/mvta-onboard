-- Migration 146: one schedule review row per change, not one a day.
--
-- Until migration 145 the static sync stored the same review every day, so
-- GtfsPredictionRiskReviews holds runs of identical rows (same review_json,
-- one after another). Since 145 a new row is written only when the review
-- changes, and the history endpoint folded the old runs together with a
-- window-function query. This removes the runs instead, so the history is a
-- plain read of the table (v1.6.9, lib/scheduleReview/store.ts).
--
-- For each run of identical consecutive rows it keeps the NEWEST row - the
-- one the first post-145 sync wrote its per-route detail against - and sets
-- its reviewed_at to when the run was first seen and confirmed_at to when it
-- was last seen. The other rows of the run are deleted, with any detail rows
-- they hold (rows from before 145 hold none). History reads exactly as the
-- fold showed it.
--
-- Deletes rows. Run after 143 and 145. Re-runnable: with no runs left it
-- changes nothing.

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

WITH marked AS (
  SELECT review_id, reviewed_at, ISNULL(confirmed_at, reviewed_at) AS seen_at,
         CASE WHEN HASHBYTES('SHA2_256', review_json)
                 = LAG(HASHBYTES('SHA2_256', review_json)) OVER (ORDER BY reviewed_at, review_id)
              THEN 0 ELSE 1 END AS starts_run
  FROM dbo.GtfsPredictionRiskReviews
),
runs AS (
  SELECT review_id, reviewed_at, seen_at,
         SUM(starts_run) OVER (ORDER BY reviewed_at, review_id ROWS UNBOUNDED PRECEDING) AS run_no
  FROM marked
)
SELECT r.review_id, s.keep_id, s.first_seen_at, s.last_seen_at
INTO #ScheduleReviewRuns
FROM runs r
JOIN (
  SELECT run_no, MAX(review_id) AS keep_id, MIN(reviewed_at) AS first_seen_at, MAX(seen_at) AS last_seen_at
  FROM runs
  GROUP BY run_no
  HAVING COUNT(*) > 1
) s ON s.run_no = r.run_no;

DELETE d
FROM dbo.GtfsScheduleReviewRoutes d
JOIN #ScheduleReviewRuns x ON x.review_id = d.review_id AND x.review_id <> x.keep_id;

DELETE r
FROM dbo.GtfsPredictionRiskReviews r
JOIN #ScheduleReviewRuns x ON x.review_id = r.review_id AND x.review_id <> x.keep_id;

UPDATE r
SET reviewed_at = x.first_seen_at,
    confirmed_at = x.last_seen_at
FROM dbo.GtfsPredictionRiskReviews r
JOIN #ScheduleReviewRuns x ON x.review_id = r.review_id AND x.review_id = x.keep_id;

DECLARE @kept INT = (SELECT COUNT(DISTINCT keep_id) FROM #ScheduleReviewRuns);
DECLARE @removed INT = (SELECT COUNT(*) FROM #ScheduleReviewRuns WHERE review_id <> keep_id);
DROP TABLE #ScheduleReviewRuns;

COMMIT TRANSACTION;

PRINT CONCAT('Migration 146 applied: ', @removed, ' repeated schedule review rows removed, ', @kept, ' kept.');
GO
