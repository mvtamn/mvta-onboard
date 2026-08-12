-- Repair for databases where migration 046 was run before Detours existed.
-- Run migrations 017 and 041 first, then run this script. It is safe to rerun.
IF OBJECT_ID('dbo.Detours', 'U') IS NULL
  THROW 50049, 'Migration 049 requires migration 017 (Detours) first.', 1;
IF COL_LENGTH('dbo.Detours', 'lifecycle_state') IS NULL
  THROW 50049, 'Migration 049 requires migration 041 (detour workflow) first.', 1;
GO

IF OBJECT_ID('dbo.DetourWorkflowHistory', 'U') IS NULL
BEGIN
  CREATE TABLE DetourWorkflowHistory (
    id               UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    detour_id        UNIQUEIDENTIFIER NOT NULL REFERENCES Detours(id),
    event_type       NVARCHAR(30) NOT NULL,
    from_state       NVARCHAR(30) NULL,
    to_state         NVARCHAR(30) NULL,
    source           NVARCHAR(20) NULL,
    detail           NVARCHAR(1000) NULL,
    changed_by       NVARCHAR(200) NOT NULL,
    changed_at       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_DetourWorkflowHistory_EventType CHECK
      (event_type IN ('created', 'state_transition', 'source_observation',
                      'manual_correction', 'fulfillment_confirmation'))
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DetourWorkflowHistory_Detour' AND object_id = OBJECT_ID('dbo.DetourWorkflowHistory'))
  CREATE INDEX IX_DetourWorkflowHistory_Detour ON DetourWorkflowHistory(detour_id, changed_at DESC);
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_Detours_LifecycleState' AND parent_object_id = OBJECT_ID('dbo.Detours'))
  ALTER TABLE Detours DROP CONSTRAINT DF_Detours_LifecycleState;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Detours_LifecycleState' AND parent_object_id = OBJECT_ID('dbo.Detours'))
  ALTER TABLE Detours DROP CONSTRAINT CK_Detours_LifecycleState;
GO

INSERT INTO DetourWorkflowHistory
  (detour_id, event_type, from_state, to_state, source, detail, changed_by)
SELECT id, 'state_transition', lifecycle_state,
       CASE lifecycle_state
         WHEN 'pending_avail_build' THEN 'awaiting_fulfillment'
         WHEN 'built_in_avail' THEN 'fulfilled'
         WHEN 'build_failed' THEN 'fulfillment_failed'
         WHEN 'active' THEN 'fulfilled'
         WHEN 'expired' THEN 'fulfilled'
         WHEN 'rejected' THEN 'closed'
         WHEN 'duplicate' THEN 'closed'
       END,
       CASE WHEN source = 'avail' THEN 'avail' ELSE 'manual' END,
       'Migrated from legacy lifecycle state by migration 049',
       'migration-049'
FROM Detours
WHERE lifecycle_state IN ('pending_avail_build', 'built_in_avail', 'build_failed', 'active', 'expired', 'rejected', 'duplicate')
  AND NOT EXISTS (
    SELECT 1 FROM DetourWorkflowHistory h
    WHERE h.detour_id = Detours.id
      AND h.detail = 'Migrated from legacy lifecycle state by migration 049'
  );

UPDATE Detours
SET lifecycle_state = CASE lifecycle_state
  WHEN 'pending_avail_build' THEN 'awaiting_fulfillment'
  WHEN 'built_in_avail' THEN 'fulfilled'
  WHEN 'build_failed' THEN 'fulfillment_failed'
  WHEN 'active' THEN 'fulfilled'
  WHEN 'expired' THEN 'fulfilled'
  WHEN 'rejected' THEN 'closed'
  WHEN 'duplicate' THEN 'closed'
  ELSE lifecycle_state
END;
GO

ALTER TABLE Detours ADD CONSTRAINT DF_Detours_LifecycleState DEFAULT 'fulfilled' FOR lifecycle_state;
ALTER TABLE Detours ADD CONSTRAINT CK_Detours_LifecycleState
  CHECK (lifecycle_state IN ('approved', 'awaiting_fulfillment', 'fulfilled', 'fulfillment_failed', 'closed'));
GO

PRINT 'Migration 049 applied: migration 046 detour workflow state repaired.';
