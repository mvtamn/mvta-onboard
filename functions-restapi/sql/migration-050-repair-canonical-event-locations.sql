-- Repair for migration 047 when its reserved alias caused the later batches
-- to fail after earlier link-rewrite batches had already completed.
IF OBJECT_ID('dbo.EventLocations', 'U') IS NULL
  THROW 50050, 'Migration 050 requires migration 033 (Event locations) first.', 1;
IF OBJECT_ID('dbo.EventGeofenceDirectionRules', 'U') IS NULL
  THROW 50050, 'Migration 050 requires migration 033 (direction rules) first.', 1;
GO

WITH ranked AS (
  SELECT id, FIRST_VALUE(id) OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) canonical_id,
         ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) row_number
  FROM EventLocations
  WHERE is_active = 1
)
UPDATE direction_rule SET destination_location_id = ranked.canonical_id
FROM EventGeofenceDirectionRules direction_rule
JOIN ranked ON ranked.id = direction_rule.destination_location_id
WHERE ranked.row_number > 1;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) row_number
  FROM EventLocations
  WHERE is_active = 1
)
UPDATE location_row SET is_active = 0, updated_at = SYSUTCDATETIME(), updated_by = 'migration-050'
FROM EventLocations location_row
JOIN ranked ON ranked.id = location_row.id
WHERE ranked.row_number > 1;
GO

PRINT 'Migration 050 applied: canonical Event location repair completed.';
