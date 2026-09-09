-- Migration 111: the Issuance Proof is not the Final Assessment.
--
-- "Generate Final Assessment" wrote a ComplianceReports row of type 'final'
-- with no issued_at, and the issue step later re-rendered the bytes (issuer,
-- dispute deadline), uploaded a new blob, and overwrote blob_path and
-- content_sha256 on that row. Two things were wrong with that. The pre-issue
-- render had no name, so the generate handler treated each unissued one as
-- "the latest Final" the next had to supersede - a finalized month could grow
-- v1, v2, v3 finals from one unchanged state. And the proof's own bytes, the
-- exact thing the Issuing Authority had checked, were orphaned in storage
-- with nothing in SQL pointing at them.
--
-- ADR 0029 names the pre-issue render an Issuance Proof: archived, hashed,
-- checked before the run, never sent. One live proof per period; preparing
-- another voids the prior one rather than superseding it, and nothing is
-- deleted. Issuing transitions the proof's row into the Final Assessment and
-- keeps the proof's path and hash beside the issued ones, so both artifacts
-- stay addressable from the row every foreign key already points at.
--
--   voided_at        NULL on a live proof and on every Final; set when a proof
--                    stopped being the one to check: another was prepared, the
--                    period was reopened, evidence or an Assessment Exception
--                    landed on the finalized month, or the month was finalized
--                    again after going stale under the proof.
--   voided_by        who caused it.
--   proof_blob_path  the proof's own bytes, filled at issue when blob_path
--   proof_sha256     moves to the issued render. NULL on a Validation Draft
--                    and on a proof that has not been issued.
--
-- No backfill: every existing 'final' row is either issued (fine as it is) or
-- an unissued render on dev, which the next Prepare voids on its own.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ComplianceReports', N'U') IS NULL
  THROW 50111, 'Migration 111 requires ComplianceReports (migration 030).', 1;
GO

IF COL_LENGTH('dbo.ComplianceReports', 'voided_at') IS NULL
  ALTER TABLE dbo.ComplianceReports ADD voided_at DATETIME2 NULL;
IF COL_LENGTH('dbo.ComplianceReports', 'voided_by') IS NULL
  ALTER TABLE dbo.ComplianceReports ADD voided_by NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.ComplianceReports', 'proof_blob_path') IS NULL
  ALTER TABLE dbo.ComplianceReports ADD proof_blob_path NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.ComplianceReports', 'proof_sha256') IS NULL
  ALTER TABLE dbo.ComplianceReports ADD proof_sha256 CHAR(64) NULL;
GO

-- A Final Assessment is never voided: once issued the row is immutable
-- (ADR 0006), and a voided proof is never issued.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CR_VoidedNotIssued')
  ALTER TABLE dbo.ComplianceReports ADD CONSTRAINT CK_CR_VoidedNotIssued
    CHECK (voided_at IS NULL OR issued_at IS NULL);
GO

-- At most one live Issuance Proof per period. The issue step clears the
-- proof out of this index by stamping issued_at, so the next correction
-- period (a different period_id) is unaffected.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CR_LiveProof' AND object_id = OBJECT_ID('dbo.ComplianceReports'))
  CREATE UNIQUE INDEX UX_CR_LiveProof ON dbo.ComplianceReports(period_id)
    WHERE issuance_type = 'final' AND issued_at IS NULL AND voided_at IS NULL;
GO
