-- Migration 097: garage-departure occurrences carry their source system.
--
-- ADR 0028: a compliance occurrence raised from a garage departure must carry
-- its source system in source_ref, the way the missed-trip MERGE already does
-- with source_system, before a second feed is added - otherwise one physical
-- departure could raise two occurrences against the same scored standard.
--
-- complianceCandidatesPoll used to emit FixedRouteDepartures:{date}|{block}|{run}.
-- From this release it emits FixedRouteDepartures:avail_pullout:{date}|{block}|{run}
-- for the Avail side and OnDemandDepartures:spare_duties:{duty_id} for the
-- Spare side. The MERGE that raises candidates deduplicates on source_ref, so
-- every existing fixed-route reference must be rewritten to the new shape
-- first - whatever its review status. A dismissed or confirmed occurrence
-- still names the same physical departure, and left in the old shape it would
-- be raised a second time under the new one.
--
-- Safe for assessments: PeriodKpiAssessments references occurrences by
-- ComplianceOccurrences:{id}, not by source_ref, so finalized periods are
-- untouched and a recompute sees the same occurrences under the same ids.
--
-- UX_CO_SourceRef stays unique: the rewrite is one-to-one.
--
-- Re-runnable: rows already in the new shape are not matched.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ComplianceOccurrences', N'U') IS NULL
  THROW 50097, 'Migration 097 requires ComplianceOccurrences (migration 030).', 1;

DECLARE @before INT = (
  SELECT COUNT(*) FROM dbo.ComplianceOccurrences
  WHERE source_ref LIKE N'FixedRouteDepartures:[0-9]%'
);

BEGIN TRANSACTION;
UPDATE dbo.ComplianceOccurrences
SET source_ref = CONCAT(N'FixedRouteDepartures:avail_pullout:', SUBSTRING(source_ref, LEN(N'FixedRouteDepartures:') + 1, 300))
WHERE source_ref LIKE N'FixedRouteDepartures:[0-9]%';
COMMIT;

DECLARE @after INT = (
  SELECT COUNT(*) FROM dbo.ComplianceOccurrences
  WHERE source_ref LIKE N'FixedRouteDepartures:avail_pullout:%'
);

PRINT CONCAT('Migration 097 applied: ', @before, ' garage-departure references rewritten; ', @after, ' now carry avail_pullout.');
