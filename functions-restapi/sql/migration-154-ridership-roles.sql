-- Migration 154: the two ridership roles (ADR 0032, ADR 0043).
--
--   ridership-recorder - contractor OCC staff: open Ridership, key and correct
--                        Count Sheets, print them.
--   ridership-manager  - MVTA Planning: everything a recorder can, plus the
--                        block-to-garage list (Administration > Ridership setup).
--
-- Flags, month close and the operator-name rule arrive with the January
-- increment and add their own actions then (plans/ridership-build-plan.md).
--
-- Same pattern as migration 129: a role is inserted only when its key is
-- missing, and its actions only for a role this migration has just created,
-- so an Access Administrator's later edits survive a re-run. seeds.ts carries
-- the same two roles; access.db.contract.test.ts fails if they disagree.
--
-- Seeding a role grants it to nobody. Assigning the named Planning staff and
-- the Keolis OCC guests is a separate, explicit step (build plan, Increment 1).
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.AccessRoles', 'U') IS NULL OR OBJECT_ID('dbo.AccessRoleActions', 'U') IS NULL
  THROW 50154, 'Migration 154 requires AccessRoles and AccessRoleActions (migration 129).', 1;
GO

DECLARE @seed TABLE (role_key NVARCHAR(64), name NVARCHAR(100), purpose NVARCHAR(400));
INSERT @seed (role_key, name, purpose) VALUES
 ('ridership-recorder', 'Ridership Recorder', 'Keys and corrects Count Sheets and prints them.'),
 ('ridership-manager', 'Ridership Manager', 'Runs ridership counting: everything a recorder does, plus the block-to-garage list.');

DECLARE @seedActions TABLE (role_key NVARCHAR(64), action_key NVARCHAR(100));
INSERT @seedActions (role_key, action_key) VALUES
 ('ridership-recorder', 'ridership.view'),
 ('ridership-recorder', 'ridership.enter'),
 ('ridership-recorder', 'ridership.print'),
 ('ridership-manager', 'ridership.view'),
 ('ridership-manager', 'ridership.enter'),
 ('ridership-manager', 'ridership.print'),
 ('ridership-manager', 'ridership.configure');

INSERT dbo.AccessRoles (role_key, name, purpose, is_locked, all_actions, is_seeded, created_by)
SELECT s.role_key, s.name, s.purpose, 0, 0, 1, 'migration 154'
FROM @seed s
WHERE NOT EXISTS (SELECT 1 FROM dbo.AccessRoles r WHERE r.role_key = s.role_key);

INSERT dbo.AccessRoleActions (role_key, action_key)
SELECT a.role_key, a.action_key
FROM @seedActions a
JOIN dbo.AccessRoles r ON r.role_key = a.role_key AND r.created_by = 'migration 154' AND r.updated_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.AccessRoleActions x WHERE x.role_key = a.role_key AND x.action_key = a.action_key
);

PRINT 'Migration 154: ridership roles seeded (granted to nobody).';
GO
