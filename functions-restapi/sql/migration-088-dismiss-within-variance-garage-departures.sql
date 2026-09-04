-- Migration 088: dismiss garage-departure candidates the narrowed rule would
-- never have raised.
--
-- complianceCandidatesPoll used to raise a GARAGE_DEPARTURE candidate for every
-- FixedRouteDepartures row carrying Avail's 'Expired Pullout' or 'Late Relief'
-- status, with no threshold. That status is a timing state, not an outcome: it
-- says the scheduled pullout window elapsed, not that the bus never left, and
-- most of those runs do leave a few minutes late. The poller now requires a
-- scheduled pullout that either never happened or happened more than
-- GARAGE_DEPARTURE_VARIANCE_MINUTES late, but the MERGE only inserts on
-- no-match, so candidates already raised under the old rule remain - and an
-- Assessment Period cannot be finalized while any candidate is unreviewed.
--
-- This clears that backlog the same way a reviewer would, and only where the
-- evidence says the departure happened acceptably. It is deliberately narrow:
--
--   * only GARAGE_DEPARTURE occurrences,
--   * only source='auto_candidate' - manual entries are somebody's judgement,
--   * only review_status='candidate' - never re-opens or overrides a human
--     decision that has already been made,
--   * only where the originating FixedRouteDepartures row still exists, so the
--     dismissal is grounded in evidence rather than in its absence,
--   * never inside a finalized period, whose inputs are frozen.
--
-- Occurrences are dismissed, not deleted. Each keeps its evidence, records why
-- it was dismissed and by what, and can be re-confirmed by a reviewer.
--
-- Re-runnable: a second run finds nothing, because the rows it changed are no
-- longer candidates.
--
-- Run once against the live database (private endpoint - see HANDOFF section
-- 5.7 for the temporary-public-access procedure).

SET XACT_ABORT ON;
SET NOCOUNT ON;

-- Keep in step with GARAGE_DEPARTURE_VARIANCE_MINUTES (default 10 minutes).
DECLARE @variance_seconds INT = 600;

-- Set to 0 to print the counts without changing anything.
DECLARE @apply BIT = 1;

IF OBJECT_ID(N'dbo.ComplianceOccurrences', N'U') IS NULL
   OR OBJECT_ID(N'dbo.FixedRouteDepartures', N'U') IS NULL
   OR OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
   OR OBJECT_ID(N'dbo.AssessmentPeriods', N'U') IS NULL
BEGIN
    PRINT 'Migration 088 skipped: the compliance, departure or assessment tables are not present.';
    RETURN;
END;

-- Candidates whose evidence shows an acceptable departure. This is the exact
-- negation of the poller's predicate, written out rather than as NOT(...) so
-- the NULL cases are explicit: a row with no scheduled pullout has no committed
-- time to have missed, and a row that departed inside the variance was never a
-- breach.
DECLARE @within_variance TABLE (
    id UNIQUEIDENTIFIER PRIMARY KEY,
    contractor_id UNIQUEIDENTIFIER NOT NULL,
    service_month CHAR(6) NOT NULL,
    reason NVARCHAR(1000) NOT NULL
);

INSERT INTO @within_variance (id, contractor_id, service_month, reason)
SELECT o.id, o.contractor_id, o.service_month,
    CASE
        WHEN d.pullout_scheduled IS NULL
            THEN N'Dismissed by migration 088: no scheduled pullout was recorded, so there is no committed departure time to have missed.'
        ELSE CONCAT(
            N'Dismissed by migration 088: departed ',
            DATEDIFF(MINUTE, d.pullout_scheduled, d.pullout_actual),
            N' min late, within the ', @variance_seconds / 60,
            N'-minute garage-departure variance. Avail''s ', d.pullout_status,
            N' status marks the scheduled pullout window elapsing, not a missed departure.')
    END
FROM dbo.ComplianceOccurrences o
JOIN dbo.ContractorPerformanceStandards s
    ON s.id = o.standard_id AND s.code = N'GARAGE_DEPARTURE'
JOIN dbo.FixedRouteDepartures d
    ON o.source_ref = CONCAT(N'FixedRouteDepartures:', d.service_date, N'|', d.block, N'|', d.run)
LEFT JOIN dbo.AssessmentPeriods p
    ON p.contractor_id = o.contractor_id AND p.service_month = o.service_month
WHERE o.source = N'auto_candidate'
  AND o.review_status = N'candidate'
  AND ISNULL(p.status, N'open') <> N'finalized'
  AND (
        d.pullout_scheduled IS NULL
     OR (d.pullout_actual IS NOT NULL
         AND DATEDIFF(SECOND, d.pullout_scheduled, d.pullout_actual) <= @variance_seconds)
      );

DECLARE @to_dismiss INT = (SELECT COUNT(*) FROM @within_variance);

-- Reported, never touched. These cannot be re-evaluated against the new rule,
-- so they stay in the queue for a person rather than being cleared on the
-- strength of missing evidence.
DECLARE @unmatched INT = (
    SELECT COUNT(*)
    FROM dbo.ComplianceOccurrences o
    JOIN dbo.ContractorPerformanceStandards s
        ON s.id = o.standard_id AND s.code = N'GARAGE_DEPARTURE'
    WHERE o.source = N'auto_candidate'
      AND o.review_status = N'candidate'
      AND NOT EXISTS (
            SELECT 1 FROM dbo.FixedRouteDepartures d
            WHERE o.source_ref = CONCAT(N'FixedRouteDepartures:', d.service_date, N'|', d.block, N'|', d.run))
);

DECLARE @remaining INT = (
    SELECT COUNT(*)
    FROM dbo.ComplianceOccurrences o
    JOIN dbo.ContractorPerformanceStandards s
        ON s.id = o.standard_id AND s.code = N'GARAGE_DEPARTURE'
    WHERE o.source = N'auto_candidate' AND o.review_status = N'candidate'
) - @to_dismiss;

PRINT CONCAT('Migration 088: ', @to_dismiss, ' garage-departure candidates are within variance and will be dismissed.');
PRINT CONCAT('Migration 088: ', @remaining, ' candidates still require review (of which ', @unmatched, ' have no matching FixedRouteDepartures row and were left untouched).');

IF @apply = 0
BEGIN
    PRINT 'Migration 088: preview only (@apply = 0); nothing was changed.';
    RETURN;
END;

BEGIN TRANSACTION;

UPDATE o
SET review_status = N'dismissed',
    attribution = N'undetermined',
    dismiss_reason = w.reason,
    reviewed_by = N'migration-088-garage-departure-variance',
    reviewed_at = SYSUTCDATETIME()
FROM dbo.ComplianceOccurrences o
JOIN @within_variance w ON w.id = o.id;

-- Dismissing changes a period's inputs, so the period is re-opened for
-- recalculation exactly as the review endpoint does. Finalized periods are
-- excluded above and are not touched here either.
UPDATE p
SET input_revision = p.input_revision + 1,
    status = CASE WHEN p.status IN (N'in_review', N'stale') THEN N'stale' ELSE p.status END
FROM dbo.AssessmentPeriods p
WHERE p.status <> N'finalized'
  AND EXISTS (
        SELECT 1 FROM @within_variance w
        WHERE w.contractor_id = p.contractor_id AND w.service_month = p.service_month);

COMMIT;

PRINT CONCAT('Migration 088 applied: ', @to_dismiss, ' garage-departure candidates dismissed as within variance.');
