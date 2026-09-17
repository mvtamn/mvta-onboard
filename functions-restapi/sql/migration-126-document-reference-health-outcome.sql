-- Migration 126: record why a Supporting Document Reference's health is what
-- it is, not only what it is.
--
-- health_status has three values - Valid, Needs review, Unavailable - and
-- Unavailable covers four different faults with four different owners: a
-- credential SharePoint rejected, a site grant that was never issued, a file
-- that is not there, and an outage. health_reason already tells a person which,
-- in words. Nothing can count them. The governance workspace needs to say "N
-- document checks were refused by SharePoint" - the signal that the site grant
-- is missing, which on 2026-09-14 and 2026-09-17 was reported done and was not -
-- and it cannot derive that from free text.
--
-- health_outcome is that count's source:
--   ok         the document was read; health_status is Valid or Needs review
--   forbidden  SharePoint refused the read (401 or 403) - access, not the document
--   not_found  no document at the recorded site, drive and item
--   failed     the read could not complete (an outage, a token that failed)
-- NULL means never checked, or last checked before this migration. There is no
-- "not configured": a check with no documents application records nothing.
--
-- The code that writes this column checks for it first, so it keeps working on a
-- database this migration has not reached.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ProcedureDocumentReferences', N'U') IS NULL
  THROW 50126, 'Migration 126 requires ProcedureDocumentReferences (migration 076).', 1;
GO

IF COL_LENGTH('dbo.ProcedureDocumentReferences', 'health_outcome') IS NULL
  ALTER TABLE dbo.ProcedureDocumentReferences ADD health_outcome NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ProcedureDocumentReferences_HealthOutcome')
  ALTER TABLE dbo.ProcedureDocumentReferences
    ADD CONSTRAINT CK_ProcedureDocumentReferences_HealthOutcome
    CHECK (health_outcome IS NULL OR health_outcome IN ('ok', 'forbidden', 'not_found', 'failed'));
GO

PRINT 'Migration 126 applied: ProcedureDocumentReferences.health_outcome added.';
