-- Migration 104: measurement_source names where the number comes from, in the
-- four ways it actually arrives.
--
-- The column has carried 'auto' and 'manual' since migration 030, and both
-- collapse two genuinely different things:
--
--   'auto'   was an external feed the app ingests (Avail's monthly OTP) AND
--            occurrences OnBoard raises itself from its own compliance
--            modules. Nothing distinguished them, yet only the first has a
--            resolver to call at compute time - which is the confusion the
--            resolver registry had to model around with `appliesTo`.
--
--   'manual' was a figure somebody types in from their own knowledge AND a
--            figure transcribed from another system's structured report -
--            Nexus for operator conduct complaints, Asset Works M5 for
--            maintenance. The second has a named source system, a schema, and
--            a plausible route to becoming an api_feed later. The first never
--            will.
--
-- Four values, and a source_system for the one kind that has one:
--
--   api_feed            a feed this application ingests directly
--   onboard_compliance  occurrences OnBoard raises from its own modules
--   manual_entry        typed in by a person
--   structured_import   transcribed from another system's structured report
--
-- Conversion is mechanical and makes no judgement about which standards MVTA
-- reports from Nexus or M5. 'auto' splits on standard_type, which is exactly
-- what distinguished the two cases in practice; 'manual' becomes manual_entry
-- for every row. Reclassifying a standard as structured_import and naming its
-- source system is a data edit on Administration > Performance Standards -
-- which is a contract and reporting fact, not something a migration should
-- guess.
--
-- Existing AssessmentPeriodStandards snapshots are deliberately NOT converted.
-- They record what a finalized month was scored under, and the compute reads
-- both vocabularies. Rewriting them would restate history to match a
-- vocabulary that did not exist when the month was scored.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
  THROW 50104, 'Migration 104 requires ContractorPerformanceStandards (migration 030).', 1;
GO

IF COL_LENGTH('dbo.ContractorPerformanceStandards','source_system') IS NULL
  ALTER TABLE dbo.ContractorPerformanceStandards ADD source_system NVARCHAR(100) NULL;
GO

-- The old constraint has to go before the rows can hold the new vocabulary.
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_CPS_Source' AND parent_object_id=OBJECT_ID('dbo.ContractorPerformanceStandards'))
  ALTER TABLE dbo.ContractorPerformanceStandards DROP CONSTRAINT CK_CPS_Source;
GO

UPDATE dbo.ContractorPerformanceStandards
SET measurement_source = CASE
      WHEN measurement_source = 'auto' AND standard_type = 'occurrence' THEN 'onboard_compliance'
      WHEN measurement_source = 'auto' THEN 'api_feed'
      WHEN measurement_source = 'manual' THEN 'manual_entry'
      ELSE measurement_source END
WHERE measurement_source IN ('auto', 'manual');
GO

IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_CPS_Source' AND parent_object_id=OBJECT_ID('dbo.ContractorPerformanceStandards'))
  ALTER TABLE dbo.ContractorPerformanceStandards
    ADD CONSTRAINT CK_CPS_Source CHECK (measurement_source IN ('api_feed', 'onboard_compliance', 'manual_entry', 'structured_import'));
GO

-- A source system belongs to a structured import and nowhere else: on any
-- other kind it would name a provenance the compute does not read.
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_CPS_SourceSystem' AND parent_object_id=OBJECT_ID('dbo.ContractorPerformanceStandards'))
  ALTER TABLE dbo.ContractorPerformanceStandards
    ADD CONSTRAINT CK_CPS_SourceSystem CHECK (source_system IS NULL OR measurement_source = 'structured_import');
GO

PRINT 'Migration 104 verified: measurement_source distinguishes feed, OnBoard compliance, manual entry and structured import.';
