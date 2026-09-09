-- Migration 112: a period records when its rule set stopped being editable.
--
-- A period snapshots the standards and bands it will be scored against when it
-- opens (migration 032b), and nothing has ever refreshed that snapshot. The
-- snapshot exists so a finalised month recomputes to the same number months
-- later, which is right - but it is currently applied to every period for its
-- whole life, and that has a consequence nobody chose:
--
--   Assign a standard to an Agreement while a month is open, and that month can
--   never score it. Recompute reads the snapshot, so it changes nothing. Reopen
--   copies the old snapshot forward, so it changes nothing either. The only way
--   to correct the rules of an open month is to delete the period row by hand.
--
-- rules_locked_at draws the line the snapshot was always meant to draw. Until a
-- period is finalised or issued its rule set is still a draft and a recompute
-- refreshes it from the catalog; from the moment it is finalised the snapshot
-- is frozen, and a reopened or superseding period inherits that lock so a
-- correction recomputes the rules as they were when the money was agreed.
--
-- BACKFILL IS DELIBERATELY CONSERVATIVE. Every period that has ever been
-- finalised, issued or reopened is locked, using its own finalised timestamp
-- where it has one. Only a period that has never left the drafting stages is
-- left unlocked, because only there is there no promise to keep.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.AssessmentPeriods', N'U') IS NULL
  THROW 50112, 'Migration 112 requires AssessmentPeriods (migration 030).', 1;
GO

IF COL_LENGTH('dbo.AssessmentPeriods', 'rules_locked_at') IS NULL
  ALTER TABLE dbo.AssessmentPeriods ADD rules_locked_at DATETIME2 NULL;
GO

-- Lock every period that has reached a stage where its numbers were relied on.
-- 'reopened' is included because a reopened period is a correction of one that
-- was finalised: it must recompute against the rules that produced the figure
-- being corrected, not against today's catalog.
UPDATE dbo.AssessmentPeriods
   SET rules_locked_at = COALESCE(finalized_at, SYSUTCDATETIME())
 WHERE rules_locked_at IS NULL
   AND (status IN ('finalized', 'issued', 'reopened') OR finalized_at IS NOT NULL);
GO
