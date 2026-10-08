-- Migration 139: dismiss garage-departure candidates raised from a pullout
-- Avail never scheduled.
--
-- Avail publishes a run with no committed pullout time as midnight rather than
-- leaving it blank, and the candidate rule's IS NOT NULL guard never caught it
-- (see lib/fixedRouteDepartureOutcome.ts, and migration 138 for why the column
-- reads the way it does). The rule now matches the time, so no further
-- placeholder becomes a candidate - but the MERGE that raises candidates only
-- inserts on no-match, so everything raised under the old rule is still in the
-- queue, and an Assessment Period cannot be finalized while a candidate is
-- unreviewed.
--
-- These rows are not marginal judgements. They are the same 18 blocks every
-- day - among them 2222, 3333, 4444, 5555, 6666, 7777 and 9999, which are
-- placeholders rather than service - and not one of them has recorded a
-- departure in the whole history of the feed.
--
-- This clears them the way a reviewer would, and only where the evidence says
-- there was no departure to make. Deliberately narrow, following migration
-- 088a clause for clause:
--
--   * only GARAGE_DEPARTURE occurrences,
--   * only source='auto_candidate' - a manual entry is somebody's judgement,
--   * only review_status='candidate' - never re-opens or overrides a decision
--     a person has already made,
--   * only where the originating FixedRouteDepartures row still exists and
--     still carries a midnight scheduled pullout, so the dismissal is grounded
--     in evidence rather than in its absence,
--   * never inside a finalized or issued period, whose inputs are frozen.
--
-- Occurrences are dismissed, not deleted. Each keeps its evidence, records why
-- it was dismissed and by what, and a reviewer can re-confirm it.
--
-- Attribution is 'undetermined', as in 088a. A run with no scheduled pullout is
-- neither the contractor's error nor MVTA-directed nor an excusable delay -
-- there was no committed departure for any of those to be true of.
--
-- ORDER RELATIVE TO MIGRATION 138. Either order works. 138 turns the stored
-- wall clock into real UTC instants, which moves the placeholder from 00:00 to
-- 05:00Z in summer and 06:00Z in winter, so the test for midnight has to follow
-- the reading actually in force. The AppSettings marker 138 writes is what says
-- which, and this migration reads it rather than assuming.
--
-- Re-runnable: a second run finds nothing, because the rows it changed are no
-- longer candidates.
--
-- Run once against the live database (private endpoint - see HANDOFF section
-- 5.7 for the temporary-public-access procedure).

SET XACT_ABORT ON;
SET NOCOUNT ON;

-- Set to 1 to apply. Leave at 0 to print the counts without changing anything.
DECLARE @apply BIT = 0;

IF OBJECT_ID(N'dbo.ComplianceOccurrences', N'U') IS NULL
   OR OBJECT_ID(N'dbo.FixedRouteDepartures', N'U') IS NULL
   OR OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
   OR OBJECT_ID(N'dbo.AssessmentPeriods', N'U') IS NULL
   OR OBJECT_ID(N'dbo.AppSettings', N'U') IS NULL
BEGIN
    PRINT 'Migration 139 skipped: the compliance, departure, standards, assessment or settings tables are not present.';
    RETURN;
END;

-- Which reading of pullout_scheduled is in force. See ORDER above.
DECLARE @times_are_utc BIT =
    CASE WHEN EXISTS (SELECT 1 FROM dbo.AppSettings
                      WHERE module = N'avail_pullout' AND setting_key = N'times_are_utc_since')
         THEN 1 ELSE 0 END;

PRINT CONCAT('Migration 139: reading pullout_scheduled as ',
             CASE WHEN @times_are_utc = 1 THEN 'UTC instants (migration 138 applied)'
                  ELSE 'agency-local wall clock (migration 138 not yet applied)' END, '.');

DECLARE @placeholders TABLE (
    id            UNIQUEIDENTIFIER PRIMARY KEY,
    contractor_id UNIQUEIDENTIFIER NOT NULL,
    service_month CHAR(6)          NOT NULL,
    reason        NVARCHAR(1000)   NOT NULL
);

INSERT INTO @placeholders (id, contractor_id, service_month, reason)
SELECT o.id, o.contractor_id, o.service_month,
    CONCAT(N'Dismissed by migration 139: Avail scheduled no pullout for block ', d.block,
           N', run ', d.run, N' on ', o.service_date,
           N'. Its scheduled pullout is midnight, which is how the feed reports a run with no ',
           N'committed departure time rather than leaving the value blank, so there was no ',
           N'departure to miss. Avail''s ', ISNULL(d.pullout_status, N'(none)'),
           N' status describes a run it never scheduled.')
FROM dbo.ComplianceOccurrences o
JOIN dbo.ContractorPerformanceStandards s
    ON s.id = o.standard_id AND s.code = N'GARAGE_DEPARTURE'
JOIN dbo.FixedRouteDepartures d
    ON o.source_ref = CONCAT(N'FixedRouteDepartures:avail_pullout:', d.service_date, N'|', d.block, N'|', d.run)
LEFT JOIN dbo.AssessmentPeriods p
    ON p.contractor_id = o.contractor_id AND p.service_month = o.service_month
WHERE o.source = N'auto_candidate'
  AND o.review_status = N'candidate'
  AND ISNULL(p.status, N'open') NOT IN (N'finalized', N'issued')
  AND d.pullout_scheduled IS NOT NULL
  AND CASE WHEN @times_are_utc = 1
           THEN CAST(d.pullout_scheduled AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS TIME)
           ELSE CAST(d.pullout_scheduled AS TIME) END = '00:00:00';

DECLARE @to_dismiss INT = (SELECT COUNT(*) FROM @placeholders);

-- Reported, never touched: a placeholder somebody has already decided about.
-- Overriding that is not a migration's call. Any row here is worth looking at,
-- because it is a charge against the contractor for a run Avail never
-- scheduled - it needs a person to reopen it, not a script.
DECLARE @already_decided INT = (
    SELECT COUNT(*)
    FROM dbo.ComplianceOccurrences o
    JOIN dbo.ContractorPerformanceStandards s
        ON s.id = o.standard_id AND s.code = N'GARAGE_DEPARTURE'
    JOIN dbo.FixedRouteDepartures d
        ON o.source_ref = CONCAT(N'FixedRouteDepartures:avail_pullout:', d.service_date, N'|', d.block, N'|', d.run)
    WHERE o.review_status <> N'candidate'
      AND d.pullout_scheduled IS NOT NULL
      AND CASE WHEN @times_are_utc = 1
               THEN CAST(d.pullout_scheduled AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS TIME)
               ELSE CAST(d.pullout_scheduled AS TIME) END = '00:00:00'
);

-- Frozen periods are excluded above rather than failing the run; say how many.
DECLARE @frozen INT = (
    SELECT COUNT(*)
    FROM dbo.ComplianceOccurrences o
    JOIN dbo.ContractorPerformanceStandards s
        ON s.id = o.standard_id AND s.code = N'GARAGE_DEPARTURE'
    JOIN dbo.FixedRouteDepartures d
        ON o.source_ref = CONCAT(N'FixedRouteDepartures:avail_pullout:', d.service_date, N'|', d.block, N'|', d.run)
    JOIN dbo.AssessmentPeriods p
        ON p.contractor_id = o.contractor_id AND p.service_month = o.service_month
    WHERE o.source = N'auto_candidate'
      AND o.review_status = N'candidate'
      AND p.status IN (N'finalized', N'issued')
      AND d.pullout_scheduled IS NOT NULL
      AND CASE WHEN @times_are_utc = 1
               THEN CAST(d.pullout_scheduled AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS TIME)
               ELSE CAST(d.pullout_scheduled AS TIME) END = '00:00:00'
);

DECLARE @remaining INT = (
    SELECT COUNT(*)
    FROM dbo.ComplianceOccurrences o
    JOIN dbo.ContractorPerformanceStandards s
        ON s.id = o.standard_id AND s.code = N'GARAGE_DEPARTURE'
    WHERE o.review_status = N'candidate'
) - @to_dismiss;

PRINT CONCAT('Migration 139: ', @to_dismiss, ' placeholder candidates will be dismissed.');
PRINT CONCAT('Migration 139: ', @remaining, ' garage-departure candidates still require review.');
IF @frozen > 0
    PRINT CONCAT('Migration 139: ', @frozen, ' left untouched inside a finalized or issued period.');
IF @already_decided > 0
    PRINT CONCAT('Migration 139: ', @already_decided, ' placeholder occurrence(s) have ALREADY BEEN REVIEWED and were left alone. ',
                 'Each is a decision taken about a run Avail never scheduled, so each is worth reopening by hand:');

IF @already_decided > 0
    SELECT o.service_date, o.service_month, o.review_status, o.attribution, o.reviewed_by,
           CONVERT(VARCHAR(19), o.reviewed_at, 120) AS reviewed_at, d.block, d.run, d.pullout_status
    FROM dbo.ComplianceOccurrences o
    JOIN dbo.ContractorPerformanceStandards s
        ON s.id = o.standard_id AND s.code = N'GARAGE_DEPARTURE'
    JOIN dbo.FixedRouteDepartures d
        ON o.source_ref = CONCAT(N'FixedRouteDepartures:avail_pullout:', d.service_date, N'|', d.block, N'|', d.run)
    WHERE o.review_status <> N'candidate'
      AND d.pullout_scheduled IS NOT NULL
      AND CASE WHEN @times_are_utc = 1
               THEN CAST(d.pullout_scheduled AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS TIME)
               ELSE CAST(d.pullout_scheduled AS TIME) END = '00:00:00'
    ORDER BY o.service_date;

IF @apply = 0
BEGIN
    PRINT 'Migration 139: preview only (@apply = 0); nothing was changed. Set @apply = 1 to apply.';
    RETURN;
END;

BEGIN TRANSACTION;

UPDATE o
SET review_status  = N'dismissed',
    attribution    = N'undetermined',
    dismiss_reason = w.reason,
    reviewed_by    = N'migration-139-garage-departure-placeholder',
    reviewed_at    = SYSUTCDATETIME()
FROM dbo.ComplianceOccurrences o
JOIN @placeholders w ON w.id = o.id;

-- Dismissing changes a period's inputs, so the period is re-opened for
-- recalculation exactly as the review endpoint does. Finalized and issued
-- periods are excluded above and are not touched here either.
UPDATE p
SET input_revision = p.input_revision + 1,
    status = CASE WHEN p.status IN (N'in_review', N'stale') THEN N'stale' ELSE p.status END
FROM dbo.AssessmentPeriods p
WHERE p.status NOT IN (N'finalized', N'issued')
  AND EXISTS (SELECT 1 FROM @placeholders w
              WHERE w.contractor_id = p.contractor_id AND w.service_month = p.service_month);

COMMIT;

PRINT CONCAT('Migration 139 applied: ', @to_dismiss, ' placeholder garage-departure candidates dismissed.');
