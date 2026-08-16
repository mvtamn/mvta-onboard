-- Complete operational Detour Intake fields. These fields stay on the intake
-- record until the same-record acceptance slice replaces the old promotion
-- boundary.

IF OBJECT_ID('dbo.DetourIntake', 'U') IS NULL
  THROW 50056, 'Migration 056 requires migration 041 (DetourIntake) first.', 1;
GO

IF COL_LENGTH('dbo.DetourIntake', 'service_impact') IS NULL
  ALTER TABLE DetourIntake ADD service_impact NVARCHAR(20) NULL;
IF COL_LENGTH('dbo.DetourIntake', 'service_area') IS NULL
  ALTER TABLE DetourIntake ADD service_area NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.DetourIntake', 'action_instructions') IS NULL
  ALTER TABLE DetourIntake ADD action_instructions NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.DetourIntake', 'proposed_fulfillment_mode') IS NULL
  ALTER TABLE DetourIntake ADD proposed_fulfillment_mode NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.DetourIntake', 'notification_audiences') IS NULL
  ALTER TABLE DetourIntake ADD notification_audiences NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.DetourIntake', 'notification_channels') IS NULL
  ALTER TABLE DetourIntake ADD notification_channels NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.DetourIntake', 'evidence_notes') IS NULL
  ALTER TABLE DetourIntake ADD evidence_notes NVARCHAR(2000) NULL;
IF COL_LENGTH('dbo.DetourIntake', 'evidence_reference') IS NULL
  ALTER TABLE DetourIntake ADD evidence_reference NVARCHAR(1000) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DetourIntake_ServiceImpact' AND parent_object_id = OBJECT_ID('dbo.DetourIntake'))
  ALTER TABLE DetourIntake ADD CONSTRAINT CK_DetourIntake_ServiceImpact
    CHECK (service_impact IS NULL OR service_impact IN ('fixed_route', 'mobility'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DetourIntake_ProposedFulfillment' AND parent_object_id = OBJECT_ID('dbo.DetourIntake'))
  ALTER TABLE DetourIntake ADD CONSTRAINT CK_DetourIntake_ProposedFulfillment
    CHECK (proposed_fulfillment_mode IS NULL OR proposed_fulfillment_mode IN ('avail', 'fixed_route_manual', 'mobility_manual'));
GO

PRINT 'Migration 056 applied: complete operational Detour Intake fields added.';
