-- Migration 114: a CAP Determination can be withdrawn.
--
-- CONTEXT says a CAP Determination "requires a separate reasoned decision to
-- remove". The status list had no state for that decision, so a plan
-- required by a corrected count could only sit overdue forever. 'withdrawn'
-- is that state: reached only from 'required', only by the Issuing
-- Authority, only with a reason on the audit row (lib/assessment/
-- capTransitions.ts), and final - a withdrawn plan is history. withdrawn_at
-- records when; closed_at stays what it was, the end of a plan that ran.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.CorrectiveActionPlans', N'U') IS NULL
  THROW 50114, 'Migration 114 requires CorrectiveActionPlans (migration 030).', 1;
GO

IF COL_LENGTH('dbo.CorrectiveActionPlans', 'withdrawn_at') IS NULL
  ALTER TABLE dbo.CorrectiveActionPlans ADD withdrawn_at DATETIME2 NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CAP_Status' AND definition NOT LIKE '%withdrawn%')
  ALTER TABLE dbo.CorrectiveActionPlans DROP CONSTRAINT CK_CAP_Status;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CAP_Status')
  ALTER TABLE dbo.CorrectiveActionPlans ADD CONSTRAINT CK_CAP_Status
    CHECK (status IN ('required','submitted','approved','in_progress','closed','failed','withdrawn'));
GO
