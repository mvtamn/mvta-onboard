-- Track the human step of entering an approved fixed-route Detour into Avail.
-- This application never creates or updates Avail records automatically.

IF OBJECT_ID('dbo.Detours', 'U') IS NULL
  THROW 50055, 'Migration 055 requires migration 017 (Detours) first.', 1;
GO

IF COL_LENGTH('dbo.Detours', 'avail_entry_result') IS NULL
  ALTER TABLE Detours ADD avail_entry_result NVARCHAR(20) NULL;
IF COL_LENGTH('dbo.Detours', 'avail_entry_confirmed_by') IS NULL
  ALTER TABLE Detours ADD avail_entry_confirmed_by NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.Detours', 'avail_entry_confirmed_at') IS NULL
  ALTER TABLE Detours ADD avail_entry_confirmed_at DATETIME2 NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_Detours_AvailEntryResult'
    AND parent_object_id = OBJECT_ID('dbo.Detours')
)
  ALTER TABLE Detours ADD CONSTRAINT CK_Detours_AvailEntryResult
    CHECK (avail_entry_result IS NULL OR avail_entry_result IN ('entered', 'conflict', 'not_entered'));
GO

PRINT 'Migration 055 applied: human Avail entry confirmation fields added.';
