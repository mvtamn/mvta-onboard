-- Migration 133: the audiences a Detour must reach when its own record names
-- none.
--
-- Intake asks whoever types a Detour who must hear about it. That works for the
-- two Detours a month entered that way, and not at all for the ten that arrive
-- from the Avail sync, which carries closure, dates and routes and no audiences
-- (availDetoursSync.ts). Those Detours read "needs communication" for ever with
-- nowhere to send: on dev, all 11 Detours have notification_audiences NULL.
--
-- A default list configured once, beside the contractor settings from migration
-- 089, gives a feed Detour the same obligations as a typed one. A Detour that
-- names its own audiences is taken at its word and does not acquire the list
-- (plans/detour-communications-implementation-plan.md, increment 2).
--
-- Seeded empty: until an administrator fills it in under Administration >
-- Detour contractor notification, nothing changes. The settings endpoint only
-- updates rows that exist, which is why this seed is needed at all.
--
-- Re-runnable.
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
  THROW 50133, 'Migration 133 requires AppSettings.', 1;
GO

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE module = 'detour' AND setting_key = 'default_audiences')
  INSERT INTO AppSettings (module, setting_key, setting_value, value_type, description)
  VALUES ('detour', 'default_audiences', '', 'string',
          'Comma-separated audiences every Detour must reach when its own record names none, such as a Detour from the Avail feed.');
GO

PRINT 'Migration 133 applied: detour default_audiences setting seeded (empty).';
GO
