-- Migration 101: list-valued Messages columns as JSON arrays, all of them.
--
-- Messages.routes_affected, stops_affected, zones_affected, tags and channels
-- are declared "JSON array" in phase1-schema.sql and every current writer
-- stores one. Rows from before that convention hold a plain comma-separated
-- string ("web,sms"). JSON.parse on such a row failed GET /manage/messages
-- with 500 the first day its route was reachable (PR #178); PR #187 made the
-- readers tolerant of both shapes. This migration retires the old shape so
-- the column comment is true again and nothing has to guess.
--
-- Each legacy value is split on commas, trimmed, JSON-escaped and re-joined
-- as a JSON array in the original order; blank values become NULL, which the
-- readers already treat as an empty list. Values that are already JSON
-- arrays are left exactly as they are.
--
-- Re-runnable: a second run finds nothing to convert. Run once against the
-- live database (see HANDOFF section 5.7). Report first, convert, report
-- again - the two counts should read N then 0 for each column.

IF OBJECT_ID('dbo.Messages', 'U') IS NULL
  THROW 50101, 'Migration 101 requires Messages (phase1-schema.sql).', 1;
GO

-- Before: how many rows per column still hold a non-JSON, non-blank value.
SELECT 'before' AS phase,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(routes_affected)), '') IS NOT NULL AND LEFT(LTRIM(routes_affected), 1) <> '[' THEN 1 ELSE 0 END) AS routes_affected,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(stops_affected)),  '') IS NOT NULL AND LEFT(LTRIM(stops_affected),  1) <> '[' THEN 1 ELSE 0 END) AS stops_affected,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(zones_affected)),  '') IS NOT NULL AND LEFT(LTRIM(zones_affected),  1) <> '[' THEN 1 ELSE 0 END) AS zones_affected,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(tags)),            '') IS NOT NULL AND LEFT(LTRIM(tags),            1) <> '[' THEN 1 ELSE 0 END) AS tags,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(channels)),        '') IS NOT NULL AND LEFT(LTRIM(channels),        1) <> '[' THEN 1 ELSE 0 END) AS channels
FROM dbo.Messages;
GO

-- Blank strings carry no list; NULL is what the readers and writers use for "none".
UPDATE dbo.Messages SET routes_affected = NULL WHERE routes_affected IS NOT NULL AND LTRIM(RTRIM(routes_affected)) = '';
UPDATE dbo.Messages SET stops_affected  = NULL WHERE stops_affected  IS NOT NULL AND LTRIM(RTRIM(stops_affected))  = '';
UPDATE dbo.Messages SET zones_affected  = NULL WHERE zones_affected  IS NOT NULL AND LTRIM(RTRIM(zones_affected))  = '';
UPDATE dbo.Messages SET tags            = NULL WHERE tags            IS NOT NULL AND LTRIM(RTRIM(tags))            = '';
UPDATE dbo.Messages SET channels        = NULL WHERE channels        IS NOT NULL AND LTRIM(RTRIM(channels))        = '';
GO

-- Comma-separated -> JSON array, preserving order. STRING_SPLIT's ordinal
-- output (third argument) is available on Azure SQL Database.
UPDATE m SET routes_affected = j.json_value
FROM dbo.Messages m
CROSS APPLY (
  SELECT '[' + STRING_AGG('"' + STRING_ESCAPE(LTRIM(RTRIM(s.value)), 'json') + '"', ',') WITHIN GROUP (ORDER BY s.ordinal) + ']' AS json_value
  FROM STRING_SPLIT(m.routes_affected, ',', 1) s
  WHERE LTRIM(RTRIM(s.value)) <> ''
) j
WHERE m.routes_affected IS NOT NULL AND LEFT(LTRIM(m.routes_affected), 1) <> '[';

UPDATE m SET stops_affected = j.json_value
FROM dbo.Messages m
CROSS APPLY (
  SELECT '[' + STRING_AGG('"' + STRING_ESCAPE(LTRIM(RTRIM(s.value)), 'json') + '"', ',') WITHIN GROUP (ORDER BY s.ordinal) + ']' AS json_value
  FROM STRING_SPLIT(m.stops_affected, ',', 1) s
  WHERE LTRIM(RTRIM(s.value)) <> ''
) j
WHERE m.stops_affected IS NOT NULL AND LEFT(LTRIM(m.stops_affected), 1) <> '[';

UPDATE m SET zones_affected = j.json_value
FROM dbo.Messages m
CROSS APPLY (
  SELECT '[' + STRING_AGG('"' + STRING_ESCAPE(LTRIM(RTRIM(s.value)), 'json') + '"', ',') WITHIN GROUP (ORDER BY s.ordinal) + ']' AS json_value
  FROM STRING_SPLIT(m.zones_affected, ',', 1) s
  WHERE LTRIM(RTRIM(s.value)) <> ''
) j
WHERE m.zones_affected IS NOT NULL AND LEFT(LTRIM(m.zones_affected), 1) <> '[';

UPDATE m SET tags = j.json_value
FROM dbo.Messages m
CROSS APPLY (
  SELECT '[' + STRING_AGG('"' + STRING_ESCAPE(LTRIM(RTRIM(s.value)), 'json') + '"', ',') WITHIN GROUP (ORDER BY s.ordinal) + ']' AS json_value
  FROM STRING_SPLIT(m.tags, ',', 1) s
  WHERE LTRIM(RTRIM(s.value)) <> ''
) j
WHERE m.tags IS NOT NULL AND LEFT(LTRIM(m.tags), 1) <> '[';

UPDATE m SET channels = j.json_value
FROM dbo.Messages m
CROSS APPLY (
  SELECT '[' + STRING_AGG('"' + STRING_ESCAPE(LTRIM(RTRIM(s.value)), 'json') + '"', ',') WITHIN GROUP (ORDER BY s.ordinal) + ']' AS json_value
  FROM STRING_SPLIT(m.channels, ',', 1) s
  WHERE LTRIM(RTRIM(s.value)) <> ''
) j
WHERE m.channels IS NOT NULL AND LEFT(LTRIM(m.channels), 1) <> '[';
GO

-- After: every remaining non-null value must be a JSON array. A non-zero
-- count here means a value the split could not handle; inspect it by hand.
SELECT 'after' AS phase,
       SUM(CASE WHEN routes_affected IS NOT NULL AND (LEFT(LTRIM(routes_affected), 1) <> '[' OR ISJSON(routes_affected) = 0) THEN 1 ELSE 0 END) AS routes_affected,
       SUM(CASE WHEN stops_affected  IS NOT NULL AND (LEFT(LTRIM(stops_affected),  1) <> '[' OR ISJSON(stops_affected)  = 0) THEN 1 ELSE 0 END) AS stops_affected,
       SUM(CASE WHEN zones_affected  IS NOT NULL AND (LEFT(LTRIM(zones_affected),  1) <> '[' OR ISJSON(zones_affected)  = 0) THEN 1 ELSE 0 END) AS zones_affected,
       SUM(CASE WHEN tags            IS NOT NULL AND (LEFT(LTRIM(tags),            1) <> '[' OR ISJSON(tags)            = 0) THEN 1 ELSE 0 END) AS tags,
       SUM(CASE WHEN channels        IS NOT NULL AND (LEFT(LTRIM(channels),        1) <> '[' OR ISJSON(channels)        = 0) THEN 1 ELSE 0 END) AS channels
FROM dbo.Messages;
GO

PRINT 'Migration 101 applied: Messages list columns hold JSON arrays or NULL.';
