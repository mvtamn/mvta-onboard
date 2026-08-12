-- Keep one active reusable location for each normalized name/category pair.
-- Existing duplicate records are retired after their plan and rule references
-- are moved to the earliest surviving record by update timestamp; historical
-- rows remain intact.
WITH ranked AS (
  SELECT id, FIRST_VALUE(id) OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) canonical_id,
         ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) row_number
  FROM EventLocations
  WHERE is_active = 1
)
DELETE link
FROM EventServicePlanLocations link
JOIN ranked ON ranked.id = link.location_id
WHERE ranked.row_number > 1
  AND EXISTS (SELECT 1 FROM EventServicePlanLocations canonical_link WHERE canonical_link.service_plan_id = link.service_plan_id AND canonical_link.location_id = ranked.canonical_id);

WITH ranked AS (
  SELECT id, FIRST_VALUE(id) OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) canonical_id,
         ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) row_number
  FROM EventLocations
  WHERE is_active = 1
)
UPDATE link SET location_id = ranked.canonical_id
FROM EventServicePlanLocations link
JOIN ranked ON ranked.id = link.location_id
WHERE ranked.row_number > 1;

WITH ranked AS (
  SELECT id, FIRST_VALUE(id) OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) canonical_id,
         ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) row_number
  FROM EventLocations
  WHERE is_active = 1
)
DELETE link
FROM EventServicePlanRevisionLocations link
JOIN ranked ON ranked.id = link.location_id
WHERE ranked.row_number > 1
  AND EXISTS (SELECT 1 FROM EventServicePlanRevisionLocations canonical_link WHERE canonical_link.revision_id = link.revision_id AND canonical_link.location_id = ranked.canonical_id);

WITH ranked AS (
  SELECT id, FIRST_VALUE(id) OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) canonical_id,
         ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) row_number
  FROM EventLocations
  WHERE is_active = 1
)
UPDATE link SET location_id = ranked.canonical_id
FROM EventServicePlanRevisionLocations link
JOIN ranked ON ranked.id = link.location_id
WHERE ranked.row_number > 1;

WITH ranked AS (
  SELECT id, FIRST_VALUE(id) OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) canonical_id,
         ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) row_number
  FROM EventLocations
  WHERE is_active = 1
)
UPDATE rule SET destination_location_id = ranked.canonical_id
FROM EventGeofenceDirectionRules rule
JOIN ranked ON ranked.id = rule.destination_location_id
WHERE ranked.row_number > 1;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(name))), LOWER(LTRIM(RTRIM(category))) ORDER BY updated_at, id) row_number
  FROM EventLocations
  WHERE is_active = 1
)
UPDATE location SET is_active = 0, updated_at = SYSUTCDATETIME(), updated_by = 'migration-047'
FROM EventLocations location
JOIN ranked ON ranked.id = location.id
WHERE ranked.row_number > 1;
GO
PRINT 'Migration 047 applied: canonical active Event locations enforced.';
