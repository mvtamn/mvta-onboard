-- Make Detour Intake the complete source record for an operational request.
-- Annotated-map authoring and a dedicated layover planner are deliberately
-- outside this migration; source PDFs, images, and documents are retained as
-- evidence alongside the structured operating facts.

IF OBJECT_ID('dbo.DetourIntake', 'U') IS NULL OR OBJECT_ID('dbo.Detours', 'U') IS NULL
  THROW 50069, 'Migration 069 requires DetourIntake and Detours.', 1;
GO

IF COL_LENGTH('dbo.DetourIntake', 'proposed_start_time') IS NULL ALTER TABLE DetourIntake ADD proposed_start_time TIME NULL;
IF COL_LENGTH('dbo.DetourIntake', 'proposed_end_time') IS NULL ALTER TABLE DetourIntake ADD proposed_end_time TIME NULL;
IF COL_LENGTH('dbo.DetourIntake', 'time_window_status') IS NULL ALTER TABLE DetourIntake ADD time_window_status NVARCHAR(20) NOT NULL CONSTRAINT DF_DetourIntake_TimeWindowStatus DEFAULT 'pending';
IF COL_LENGTH('dbo.DetourIntake', 'affected_stops_and_stations') IS NULL ALTER TABLE DetourIntake ADD affected_stops_and_stations NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.DetourIntake', 'operational_impacts') IS NULL ALTER TABLE DetourIntake ADD operational_impacts NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.DetourIntake', 'confirmation_contact') IS NULL ALTER TABLE DetourIntake ADD confirmation_contact NVARCHAR(500) NULL;

IF COL_LENGTH('dbo.Detours', 'start_time') IS NULL ALTER TABLE Detours ADD start_time TIME NULL;
IF COL_LENGTH('dbo.Detours', 'end_time') IS NULL ALTER TABLE Detours ADD end_time TIME NULL;
IF COL_LENGTH('dbo.Detours', 'time_window_status') IS NULL ALTER TABLE Detours ADD time_window_status NVARCHAR(20) NOT NULL CONSTRAINT DF_Detours_TimeWindowStatus DEFAULT 'pending';
IF COL_LENGTH('dbo.Detours', 'affected_stops_and_stations') IS NULL ALTER TABLE Detours ADD affected_stops_and_stations NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.Detours', 'operational_impacts') IS NULL ALTER TABLE Detours ADD operational_impacts NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.Detours', 'confirmation_contact') IS NULL ALTER TABLE Detours ADD confirmation_contact NVARCHAR(500) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DetourIntake_TimeWindowStatus' AND parent_object_id = OBJECT_ID('dbo.DetourIntake'))
  ALTER TABLE DetourIntake ADD CONSTRAINT CK_DetourIntake_TimeWindowStatus CHECK (time_window_status IN ('pending', 'estimated', 'confirmed'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Detours_TimeWindowStatus' AND parent_object_id = OBJECT_ID('dbo.Detours'))
  ALTER TABLE Detours ADD CONSTRAINT CK_Detours_TimeWindowStatus CHECK (time_window_status IN ('pending', 'estimated', 'confirmed'));
GO

IF OBJECT_ID('dbo.DetourImages', 'U') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.DetourImages', 'intake_id') IS NULL
  BEGIN
    ALTER TABLE DetourImages ALTER COLUMN detour_id UNIQUEIDENTIFIER NULL;
    ALTER TABLE DetourImages ADD intake_id UNIQUEIDENTIFIER NULL;
    ALTER TABLE DetourImages ADD CONSTRAINT FK_DetourImages_Intake FOREIGN KEY (intake_id) REFERENCES DetourIntake(id);
    CREATE INDEX IX_DetourImages_IntakeId ON DetourImages (intake_id) WHERE intake_id IS NOT NULL;
  END
  -- A file must belong to exactly one record. SQL Server cannot compare
  -- boolean predicates with <> here, so express the two valid cases.
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DetourImages_Owner' AND parent_object_id = OBJECT_ID('dbo.DetourImages'))
    ALTER TABLE DetourImages DROP CONSTRAINT CK_DetourImages_Owner;
  ALTER TABLE DetourImages ADD CONSTRAINT CK_DetourImages_Owner CHECK ((detour_id IS NOT NULL AND intake_id IS NULL) OR (detour_id IS NULL AND intake_id IS NOT NULL));
END
GO

PRINT 'Migration 069 applied: complete intake operational details and supporting files.';
