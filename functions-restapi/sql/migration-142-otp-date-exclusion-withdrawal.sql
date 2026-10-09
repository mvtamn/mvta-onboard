-- Migration 142: let an approved weather date be withdrawn, with its evidence
-- kept.
--
-- Since migration 140 an approved date genuinely subtracts its departures from
-- the official monthly figure. Nothing could undo that. The table had exactly
-- three operations - list, create, approve - no reject, no delete, no
-- un-approve, and no control anywhere in the console. A date approved by
-- mistake (wrong day, wrong route scope, or a day that turns out not to have
-- been weather-affected) permanently inflated that month's OTP, and the only
-- way back was a hand edit against the database.
--
-- Withdrawal is NOT a delete, for the same reason approval freezes a snapshot
-- rather than subtracting live: a dispute is about what was taken out and who
-- decided it. The row stays, the frozen OtpDateExclusionDepartures stay, and
-- the status moves to 'Withdrawn' - which is enough to stop the subtraction on
-- its own, because lib/otpMonth/rules.ts joins on status = 'Approved'. What is
-- added here is only the account of who withdrew it, when, and why.
--
-- A reason is required by the API rather than by a CHECK here, so that a row
-- withdrawn by hand during an incident is not rejected by the database.
--
-- status is NVARCHAR(10) and carries no CHECK constraint, so 'Withdrawn' (9)
-- fits without widening or re-constraining the column.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.OtpDateExclusions', 'withdrawn_by') IS NULL
  ALTER TABLE dbo.OtpDateExclusions ADD withdrawn_by NVARCHAR(200) NULL;
GO

IF COL_LENGTH('dbo.OtpDateExclusions', 'withdrawn_at') IS NULL
  ALTER TABLE dbo.OtpDateExclusions ADD withdrawn_at DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.OtpDateExclusions', 'withdrawal_reason') IS NULL
  ALTER TABLE dbo.OtpDateExclusions ADD withdrawal_reason NVARCHAR(500) NULL;
GO
