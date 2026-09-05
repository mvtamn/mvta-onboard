-- Migration 089: contractor notification settings for Detours (design B15).
--
-- The fixed-route contractor must be told about every fixed-route Detour,
-- through the same drafting mechanism as internal audiences but to its own
-- recipient list. Two admin-editable settings: the contractor's display
-- name (used as the audience label on communications) and the recipient
-- addresses. Both start empty; until a name is set, no contractor audience
-- is required and communication status is unchanged.

IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
  THROW 50089, 'Migration 089 requires AppSettings (migration 032).', 1;
GO

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE module = 'detour' AND setting_key = 'contractor_name')
  INSERT INTO AppSettings (module, setting_key, setting_value, value_type, description)
  VALUES ('detour', 'contractor_name', '', 'string',
          'Fixed-route contractor name. When set, every fixed-route Detour requires a published communication to this audience.');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE module = 'detour' AND setting_key = 'contractor_recipients')
  INSERT INTO AppSettings (module, setting_key, setting_value, value_type, description)
  VALUES ('detour', 'contractor_recipients', '', 'string',
          'Comma-separated email addresses that receive contractor detour notifications.');
GO

PRINT 'Migration 089 applied: detour contractor notification settings seeded (empty).';
