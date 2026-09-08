-- Migration 102: performance standards are assigned to an agreement, not to
-- the agency as a whole.
--
-- Migration 030 seeded the Attachment G catalog with no contractor dimension,
-- and every assessment period since has snapshotted it with a bare
-- `WHERE is_scored=1`. That is correct for one contractor under one agreement
-- and cannot express anything else: not a second contractor, not an amendment
-- that changes a threshold mid-term, not a standard that applies to one
-- agreement and not another.
--
-- Three changes, in dependency order:
--
--   1. UX_PA_Active was a filtered unique index on is_active ALONE, so the
--      schema permitted exactly one active PerformanceAgreement across the
--      whole database. Re-key it on (contractor_id, is_active): one active
--      agreement PER CONTRACTOR, which is the actual rule.
--
--   2. AgreementStandards says which catalog standards a given agreement
--      scores, over which months. This is the assignment the console edits.
--
--   3. ContractorStandardTiers gains a nullable agreement_id. NULL means the
--      agency catalog default - the Attachment G library value. A row naming
--      an agreement OVERRIDES the default for that agreement only.
--
-- Tier precedence, applied wherever tiers are resolved: if any tier row exists
-- for (agreement, standard), that set governs and the catalog defaults are
-- ignored entirely - a partial override would silently blend two tier ladders
-- and produce bands nobody wrote. Otherwise the catalog defaults govern.
--
-- Safe for finalized assessments: AssessmentPeriodStandards and
-- AssessmentPeriodTiers already snapshot the governing rules per period, and
-- AssessmentPeriods.rule_set_sha256 hashes them. Nothing here touches those
-- tables, so an issued period recomputes to the same numbers.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.PerformanceAgreements', N'U') IS NULL
  THROW 50102, 'Migration 102 requires PerformanceAgreements (migration 032b).', 1;
IF OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
  THROW 50102, 'Migration 102 requires ContractorPerformanceStandards (migration 030).', 1;
GO

-- 1. One active agreement per contractor, not one per database.
IF EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_PA_Active' AND object_id=OBJECT_ID('dbo.PerformanceAgreements'))
  DROP INDEX UX_PA_Active ON dbo.PerformanceAgreements;
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_PA_ActiveByContractor' AND object_id=OBJECT_ID('dbo.PerformanceAgreements'))
  CREATE UNIQUE INDEX UX_PA_ActiveByContractor ON dbo.PerformanceAgreements(contractor_id, is_active) WHERE is_active = 1;
GO

-- 2. Which standards this agreement scores, and when.
--
-- is_scored lives here as well as on the catalog row because the two answer
-- different questions. The catalog's flag says "MVTA scores this standard at
-- all"; the agreement's says "this contractor is held to it this term". A
-- standard dormant in the catalog can be switched on for one agreement without
-- switching it on for every other.
IF OBJECT_ID(N'dbo.AgreementStandards', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AgreementStandards (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        agreement_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.PerformanceAgreements(id),
        standard_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.ContractorPerformanceStandards(id),
        is_scored BIT NOT NULL DEFAULT 1,
        effective_start_date CHAR(8) NOT NULL,
        effective_end_date CHAR(8) NULL,
        assignment_note NVARCHAR(1000) NULL,
        updated_by NVARCHAR(200) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_AGS_Standard UNIQUE (agreement_id, standard_id),
        CONSTRAINT CK_AGS_Start CHECK (effective_start_date NOT LIKE '%[^0-9]%'),
        CONSTRAINT CK_AGS_End CHECK (effective_end_date IS NULL OR (effective_end_date NOT LIKE '%[^0-9]%' AND effective_end_date >= effective_start_date))
    );
    CREATE INDEX IX_AGS_Agreement ON dbo.AgreementStandards(agreement_id) INCLUDE (standard_id, is_scored);
END;
GO

-- 3. Agreement-specific tier overrides. NULL agreement_id = catalog default.
IF COL_LENGTH('dbo.ContractorStandardTiers','agreement_id') IS NULL
  ALTER TABLE dbo.ContractorStandardTiers ADD agreement_id UNIQUEIDENTIFIER NULL REFERENCES dbo.PerformanceAgreements(id);
GO

-- UQ_CST_Version was (standard_id, tier_order, effective_start_date), which
-- forbids exactly the row this migration exists to allow: an agreement's own
-- tier 1 alongside the catalog's tier 1 over the same dates. Re-key it to
-- include the scope. SQL Server compares NULLs as equal in a unique
-- constraint, so the catalog rows (agreement_id NULL) stay mutually unique.
IF EXISTS(SELECT 1 FROM sys.key_constraints WHERE name='UQ_CST_Version' AND parent_object_id=OBJECT_ID('dbo.ContractorStandardTiers'))
  ALTER TABLE dbo.ContractorStandardTiers DROP CONSTRAINT UQ_CST_Version;
GO
IF NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE name='UQ_CST_ScopedVersion' AND parent_object_id=OBJECT_ID('dbo.ContractorStandardTiers'))
  ALTER TABLE dbo.ContractorStandardTiers
    ADD CONSTRAINT UQ_CST_ScopedVersion UNIQUE (standard_id, agreement_id, tier_order, effective_start_date);
GO

-- Resolving a ladder reads every tier row for one standard and filters by
-- scope and effective window; without this the plan scans the table once per
-- standard per period.
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_CST_StandardScope' AND object_id=OBJECT_ID('dbo.ContractorStandardTiers'))
  CREATE INDEX IX_CST_StandardScope ON dbo.ContractorStandardTiers(standard_id, agreement_id)
    INCLUDE (tier_order, effective_start_date, effective_end_date);
GO

-- Backfill: every active agreement inherits the catalog as it stands today, so
-- the first period opened after this migration snapshots exactly what the last
-- one did. The seeded rows are ordinary editable rows - nothing here is
-- special-cased later.
INSERT dbo.AgreementStandards(agreement_id, standard_id, is_scored, effective_start_date, assignment_note, updated_by)
SELECT a.id, s.id, s.is_scored, CONVERT(char(8), a.starts_on, 112),
       N'Inherited from the agency catalog by migration 102.', N'migration-102'
FROM dbo.PerformanceAgreements a
CROSS JOIN dbo.ContractorPerformanceStandards s
WHERE a.is_active = 1
  AND NOT EXISTS(SELECT 1 FROM dbo.AgreementStandards x WHERE x.agreement_id = a.id AND x.standard_id = s.id);
GO

PRINT 'Migration 102 verified: agreements own their standard assignments and tier overrides.';
