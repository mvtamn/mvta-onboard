-- Migration 112: a Shared Validation Draft is bound to the items it showed.
--
-- Sharing a Validation Draft starts the contractor's Validation Window
-- (ADR 0009). What it shared was recorded as a report id, and finalize only
-- checked that the computation revision had not moved. Review writes
-- recommended_* after compute without moving that revision, so an amount
-- could be recommended one way on the shared draft and another way at
-- finalization, and the Final would bind the second without a new window.
--
-- The share now records the computation revision and one hash over every
-- Assessment Item's reviewed_input_sha256 (in standard order, computed in
-- SQL by lib/assessment/reviewedItems.ts). Finalize recomputes the hash and
-- refuses when the open share's differs. Both columns are nullable: shares
-- recorded before this migration carry NULL, and a period holding only such
-- a share must be re-shared before it can finalize - the safe reading, since
-- nothing proves what those shares showed.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ValidationDraftShares', N'U') IS NULL
  THROW 50112, 'Migration 112 requires ValidationDraftShares (migration 032b).', 1;
GO

IF COL_LENGTH('dbo.ValidationDraftShares', 'computed_revision') IS NULL
  ALTER TABLE dbo.ValidationDraftShares ADD computed_revision INT NULL;
IF COL_LENGTH('dbo.ValidationDraftShares', 'items_sha256') IS NULL
  ALTER TABLE dbo.ValidationDraftShares ADD items_sha256 CHAR(64) NULL;
GO
