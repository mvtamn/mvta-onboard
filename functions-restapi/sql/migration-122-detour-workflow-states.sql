-- Migration 122: bring stored Detours in line with the Detour workflow acts
-- (ADR-0030, PR #309).
--
-- 1. `approved` stops being a Workflow state. Promotion is the approval, and
--    nothing has written `approved` since the workflow module took over;
--    the module refuses to act on a row still holding it. Each such row moves
--    to the state the module starts a Detour in - awaiting_fulfillment when
--    Avail-backed, fulfilled otherwise - with a history entry.
--
-- 2. A Detour first seen in the Avail feed is Avail-backed. The sync used to
--    insert without a fulfillment mode, so those rows took the column default
--    'fixed_route_manual'. Rows with source = 'avail' move to 'avail'; their
--    Workflow state is kept, and no Avail build confirmation is invented.
--    A row whose mode was deliberately changed (fulfillment_change_reason set)
--    is left alone.
--
-- 3. CK_Detours_LifecycleState no longer admits 'approved'.
--
-- Re-runnable: every step finds nothing to do on a second pass, and the
-- constraint is rebuilt only while it still admits 'approved'. Counts print
-- before and after.
--
-- Rows written here carry changed_by = 'migration-122' (see sql/README.md,
-- "What a rename must never touch").

IF OBJECT_ID('dbo.Detours', 'U') IS NULL OR OBJECT_ID('dbo.DetourWorkflowHistory', 'U') IS NULL
  THROW 50122, 'Migration 122 requires Detours and DetourWorkflowHistory (migrations 017 and 049).', 1;
IF COL_LENGTH('dbo.Detours', 'fulfillment_change_reason') IS NULL
  THROW 50122, 'Migration 122 requires migration 058 (Detours.fulfillment_change_reason).', 1;
GO

DECLARE @approved INT = (SELECT COUNT(*) FROM Detours WHERE lifecycle_state = 'approved');
DECLARE @feed_manual INT = (SELECT COUNT(*) FROM Detours WHERE source = 'avail' AND fulfillment_mode <> 'avail' AND fulfillment_change_reason IS NULL);
PRINT CONCAT('Migration 122 before: ', @approved, ' Detour(s) in approved; ', @feed_manual, ' Avail-feed Detour(s) not marked Avail-backed.');
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @moved TABLE (id UNIQUEIDENTIFIER NOT NULL, to_state NVARCHAR(30) NOT NULL);

UPDATE Detours
SET lifecycle_state = CASE WHEN fulfillment_mode = 'avail' THEN 'awaiting_fulfillment' ELSE 'fulfilled' END,
    workflow_updated_by = 'migration-122',
    workflow_updated_at = SYSUTCDATETIME()
OUTPUT INSERTED.id, INSERTED.lifecycle_state INTO @moved (id, to_state)
WHERE lifecycle_state = 'approved';

INSERT INTO DetourWorkflowHistory (detour_id, event_type, from_state, to_state, source, detail, changed_by)
SELECT id, 'state_transition', 'approved', to_state, 'manual',
       'Approved is not a Workflow state; moved to the starting state for its fulfillment mode by migration 122',
       'migration-122'
FROM @moved;

DECLARE @mode_changed TABLE (id UNIQUEIDENTIFIER NOT NULL, from_mode NVARCHAR(30) NOT NULL, state NVARCHAR(30) NOT NULL);

UPDATE Detours
SET fulfillment_mode = 'avail',
    workflow_updated_by = 'migration-122',
    workflow_updated_at = SYSUTCDATETIME()
OUTPUT INSERTED.id, DELETED.fulfillment_mode, INSERTED.lifecycle_state INTO @mode_changed (id, from_mode, state)
WHERE source = 'avail' AND fulfillment_mode <> 'avail' AND fulfillment_change_reason IS NULL;

INSERT INTO DetourWorkflowHistory (detour_id, event_type, from_state, to_state, source, detail, changed_by)
SELECT id, 'manual_correction', state, state, 'manual',
       CONCAT('First seen in the Avail feed, so Avail-backed; fulfillment mode was ', from_mode, '. Set by migration 122'),
       'migration-122'
FROM @mode_changed;

COMMIT TRANSACTION;
SET XACT_ABORT OFF;
GO

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_Detours_LifecycleState'
    AND parent_object_id = OBJECT_ID('dbo.Detours')
    AND definition LIKE '%approved%'
)
BEGIN
  ALTER TABLE Detours DROP CONSTRAINT CK_Detours_LifecycleState;
  ALTER TABLE Detours ADD CONSTRAINT CK_Detours_LifecycleState
    CHECK (lifecycle_state IN ('awaiting_fulfillment', 'fulfilled', 'fulfillment_failed', 'closed'));
END;
GO

DECLARE @approved_after INT = (SELECT COUNT(*) FROM Detours WHERE lifecycle_state = 'approved');
DECLARE @feed_manual_after INT = (SELECT COUNT(*) FROM Detours WHERE source = 'avail' AND fulfillment_mode <> 'avail' AND fulfillment_change_reason IS NULL);
PRINT CONCAT('Migration 122 after: ', @approved_after, ' Detour(s) in approved; ', @feed_manual_after, ' Avail-feed Detour(s) not marked Avail-backed.');
PRINT 'Migration 122 applied: approved retired as a Detour Workflow state; Avail-feed Detours are Avail-backed.';
