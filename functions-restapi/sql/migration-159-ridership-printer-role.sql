-- Migration 159: the Ridership Printer role (ADR 0032, ADR 0043).
--
--   ridership-printer - garage check-in desk staff: print the next service
--                       date's Count Sheets for their garage, reprint one, and
--                       nothing else. It holds ridership.print only, so the
--                       desk opens Ridership straight on Print sheets and
--                       never sees the Count Sheets list or the counts.
--
-- The SOP draft gives printing to the check-in desk, under the Garage Manager;
-- the spec gave it to Ridership Recorder, which also keys counts. Recorder and
-- Manager keep ridership.print.
--
-- Same pattern as migrations 129 and 154: the role is inserted only when its
-- key is missing, and its action only for a role this migration has just
-- created, so an Access Administrator's later edits survive a re-run. seeds.ts
-- carries the same role; access.db.contract.test.ts fails if they disagree.
--
-- Seeding the role grants it to nobody. Granting it to each garage's desk
-- staff is a separate, explicit step (PR description).
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.AccessRoles', 'U') IS NULL OR OBJECT_ID('dbo.AccessRoleActions', 'U') IS NULL
  THROW 50159, 'Migration 159 requires AccessRoles and AccessRoleActions (migration 129).', 1;
GO

INSERT dbo.AccessRoles (role_key, name, purpose, is_locked, all_actions, is_seeded, created_by)
SELECT 'ridership-printer', 'Ridership Printer', 'Prints Count Sheets at the garage check-in desk.', 0, 0, 1, 'migration 159'
WHERE NOT EXISTS (SELECT 1 FROM dbo.AccessRoles r WHERE r.role_key = 'ridership-printer');

INSERT dbo.AccessRoleActions (role_key, action_key)
SELECT r.role_key, 'ridership.print'
FROM dbo.AccessRoles r
WHERE r.role_key = 'ridership-printer' AND r.created_by = 'migration 159' AND r.updated_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.AccessRoleActions x WHERE x.role_key = r.role_key AND x.action_key = 'ridership.print');

PRINT 'Migration 159: Ridership Printer role seeded (granted to nobody).';
GO
