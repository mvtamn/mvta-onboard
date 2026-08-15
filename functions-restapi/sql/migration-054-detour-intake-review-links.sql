-- Preserve the record a reviewer used when rejecting an intake as a duplicate.
-- Only one target is allowed: another intake or an authoritative Detour.

IF OBJECT_ID('dbo.DetourIntake', 'U') IS NULL
  THROW 50054, 'Migration 054 requires migration 041 (Detour Intake) first.', 1;
IF COL_LENGTH('dbo.DetourIntake', 'duplicate_of_intake_id') IS NULL
  ALTER TABLE DetourIntake ADD duplicate_of_intake_id UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('dbo.DetourIntake', 'duplicate_of_detour_id') IS NULL
  ALTER TABLE DetourIntake ADD duplicate_of_detour_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DetourIntake_DuplicateIntake')
  ALTER TABLE DetourIntake ADD CONSTRAINT FK_DetourIntake_DuplicateIntake
    FOREIGN KEY (duplicate_of_intake_id) REFERENCES DetourIntake(id);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DetourIntake_DuplicateDetour')
  ALTER TABLE DetourIntake ADD CONSTRAINT FK_DetourIntake_DuplicateDetour
    FOREIGN KEY (duplicate_of_detour_id) REFERENCES Detours(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DetourIntake_OneDuplicateTarget')
  ALTER TABLE DetourIntake ADD CONSTRAINT CK_DetourIntake_OneDuplicateTarget
    CHECK (duplicate_of_intake_id IS NULL OR duplicate_of_detour_id IS NULL);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DetourIntake_DuplicateNeedsTarget')
  ALTER TABLE DetourIntake ADD CONSTRAINT CK_DetourIntake_DuplicateNeedsTarget
    CHECK (status <> 'duplicate' OR duplicate_of_intake_id IS NOT NULL OR duplicate_of_detour_id IS NOT NULL);
GO

PRINT 'Migration 054 applied: Detour Intake duplicate targets added.';
