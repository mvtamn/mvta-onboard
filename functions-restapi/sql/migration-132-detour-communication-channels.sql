-- Migration 132: name the channels a Detour communication can go out on, and
-- record when a recorded one actually happened.
--
-- `channel` has been any non-empty string since migration 059, and the intake
-- form offered four chips plus free text - so "radio", "Radio " and "dispatch
-- board" were three channels, none of which OnBoard could send. The approved
-- redesign (plans/detour-communications-implementation-plan.md, B9/B15 approved
-- 2026-09-17) names five: email, sms and teams are SENT by OnBoard;
-- digital_signage and avl_messaging are RECORDED, because the signs and Avail's
-- operator messaging are somebody else's to operate. Radio is dropped: no
-- Detour has ever used it.
--
-- occurred_at is when a recorded message actually went out. A Detour closes
-- after it ends, so somebody may write down on Tuesday the AVL message that
-- went out on Monday; without this column that Detour reads as communicated
-- weeks late.
--
-- dev holds ZERO DetourCommunications rows (checked 2026-09-17), so the CHECK
-- below adopts no existing data. Any environment that does hold rows must be
-- checked before this runs: a legacy channel string fails the constraint.
--
-- Re-runnable.
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.DetourCommunications', 'U') IS NULL
  THROW 50132, 'Migration 132 requires DetourCommunications (migration 059).', 1;
GO

IF COL_LENGTH('dbo.DetourCommunications', 'occurred_at') IS NULL
  ALTER TABLE dbo.DetourCommunications ADD occurred_at DATETIME2(3) NULL;
GO

-- A published row from before this migration was sent or recorded when it was
-- published; nothing else is known about it.
UPDATE dbo.DetourCommunications
   SET occurred_at = published_at
 WHERE occurred_at IS NULL AND published_at IS NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'CK_DetourCommunications_Channel'
             AND parent_object_id = OBJECT_ID('dbo.DetourCommunications'))
  ALTER TABLE dbo.DetourCommunications DROP CONSTRAINT CK_DetourCommunications_Channel;
GO

ALTER TABLE dbo.DetourCommunications ADD CONSTRAINT CK_DetourCommunications_Channel
  CHECK (channel IN ('email', 'sms', 'teams', 'digital_signage', 'avl_messaging'));
GO

PRINT 'Migration 132 applied: named Detour communication channels; occurred_at added.';
GO
