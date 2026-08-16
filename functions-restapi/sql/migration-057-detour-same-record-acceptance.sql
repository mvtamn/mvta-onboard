-- Carry the complete Intake contract into the authoritative Detour row while
-- preserving the Intake identity during OCC acceptance.

IF OBJECT_ID('dbo.Detours', 'U') IS NULL OR OBJECT_ID('dbo.DetourIntake', 'U') IS NULL
  THROW 50057, 'Migration 057 requires Detours and DetourIntake first.', 1;
GO

IF COL_LENGTH('dbo.Detours', 'service_impact') IS NULL ALTER TABLE Detours ADD service_impact NVARCHAR(20) NULL;
IF COL_LENGTH('dbo.Detours', 'service_area') IS NULL ALTER TABLE Detours ADD service_area NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.Detours', 'action_instructions') IS NULL ALTER TABLE Detours ADD action_instructions NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.Detours', 'notification_audiences') IS NULL ALTER TABLE Detours ADD notification_audiences NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.Detours', 'notification_channels') IS NULL ALTER TABLE Detours ADD notification_channels NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.Detours', 'evidence_notes') IS NULL ALTER TABLE Detours ADD evidence_notes NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.Detours', 'evidence_reference') IS NULL ALTER TABLE Detours ADD evidence_reference NVARCHAR(1000) NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DetourIntake_Status' AND parent_object_id = OBJECT_ID('dbo.DetourIntake'))
  ALTER TABLE DetourIntake DROP CONSTRAINT CK_DetourIntake_Status;
ALTER TABLE DetourIntake ADD CONSTRAINT CK_DetourIntake_Status
  CHECK (status IN ('pending_review', 'needs_information', 'accepted', 'rejected', 'duplicate', 'withdrawn'));
GO

PRINT 'Migration 057 applied: same-record acceptance fields and review states added.';
