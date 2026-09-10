-- Migration 115: an assessment carries the working its figure was made from.
--
-- Average Miles Between Road Calls is entered as the miles the fleet ran and
-- the chargeable road calls it had (v1.5.182); the figure the month scores on
-- is their quotient. PeriodKpiAssessments.metric_display snapshots that
-- figure - "13,300 miles" - and the issued report printed it with nothing
-- underneath, so a contractor reading the report could not check it. This
-- column snapshots the working beside the figure, in words, at compute time:
-- "412,300 miles ÷ 31 road calls", or "412,300 miles, no road calls". It is
-- presentation, like metric_display: it never enters scoring or the input
-- hash. NULL for a figure that was typed whole or measured by a feed.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.PeriodKpiAssessments', N'U') IS NULL
  THROW 50115, 'Migration 115 requires PeriodKpiAssessments (migration 030).', 1;
GO

IF COL_LENGTH('dbo.PeriodKpiAssessments', 'metric_working') IS NULL
  ALTER TABLE dbo.PeriodKpiAssessments ADD metric_working NVARCHAR(200) NULL;
GO
