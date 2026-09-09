-- Migration 113: an owner in the assigned_to list is a signed-in person.
--
-- assigned_to values (migration 108) are names - "Rob", "Corrina" - and
-- nothing ties a name to the account that signs into the console, so
-- nothing can tell an owner that a manual figure for the month is still
-- missing. principal_upn is the user principal name of the account that owns
-- the standards assigned to that value. It is looked at only by the
-- month-end open-inputs list; scoring never reads it. Nullable: a value with
-- no account is a team or a shared mailbox, and that is fine.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ReferenceValues', N'U') IS NULL
  THROW 50113, 'Migration 113 requires ReferenceValues (migration 105).', 1;
GO

IF COL_LENGTH('dbo.ReferenceValues', 'principal_upn') IS NULL
  ALTER TABLE dbo.ReferenceValues ADD principal_upn NVARCHAR(320) NULL;
GO
