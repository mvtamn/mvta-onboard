-- Migration 103: an assessment period records which resolver measured it.
--
-- AssessmentPeriodStandards snapshots the governing rules per period - code,
-- type, direction, unit, measurement source - so a later catalog edit cannot
-- change what a finalized month was scored against. resolver_key was the one
-- part of the rule it did not carry, which did not matter while the compute
-- ignored the column and branched on the standard's code instead.
--
-- It matters now. With a resolver registry keyed on resolver_key, repointing a
-- standard at a different resolver would silently change how an already-issued
-- month recomputes - the exact drift the snapshot exists to prevent. Snapshot
-- it, and a finalized period keeps measuring the way it was measured.
--
-- Backfill takes the catalog's current value for every existing period. That is
-- correct because until this release nothing read the column, so no period was
-- ever measured by anything other than what the catalog says today.
--
-- rule_set_json and rule_set_sha256 on existing periods are deliberately NOT
-- rewritten: they hash what was actually snapshotted at the time, and
-- back-dating them would forge the record rather than complete it. New periods
-- hash the fuller rule set from here on.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.AssessmentPeriodStandards', N'U') IS NULL
  THROW 50103, 'Migration 103 requires AssessmentPeriodStandards (migration 032).', 1;
GO

IF COL_LENGTH('dbo.AssessmentPeriodStandards','resolver_key') IS NULL
  ALTER TABLE dbo.AssessmentPeriodStandards ADD resolver_key NVARCHAR(50) NULL;
GO

UPDATE snapshot
SET resolver_key = standard.resolver_key
FROM dbo.AssessmentPeriodStandards snapshot
JOIN dbo.ContractorPerformanceStandards standard ON standard.id = snapshot.standard_id
WHERE snapshot.resolver_key IS NULL AND standard.resolver_key IS NOT NULL;
GO

PRINT 'Migration 103 verified: assessment periods carry the resolver that measured them.';
