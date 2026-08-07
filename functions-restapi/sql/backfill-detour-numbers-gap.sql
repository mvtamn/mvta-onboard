-- Gap backfill for Detours.internal_number (Part B10).
--
-- NOT a migration - this is a re-runnable repair script. migration-024's
-- backfill is a one-time pass that ran when the migration was applied. Any
-- detour created BETWEEN that moment and the deploy of the code that assigns
-- numbers (detoursCreate.ts) lands with internal_number = NULL and is missed
-- by that pass. Run this once after deploying to close the gap.
--
-- Safe to run repeatedly: it only touches rows where internal_number IS NULL,
-- and it continues each year's run from DetourNumberSequences rather than
-- restarting at 0001, so it cannot collide with an already-issued number.
-- Idempotent no-op if there is nothing to fix.

SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- Lock the sequence rows for the duration so a concurrent POST /detours
-- cannot allocate the same values this script is about to hand out.
WITH pending AS (
    SELECT
        id,
        COALESCE(YEAR(start_date), YEAR(created_at)) AS detour_year,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(YEAR(start_date), YEAR(created_at))
            ORDER BY created_at, id
        ) AS offset_in_year
    FROM Detours
    WHERE internal_number IS NULL
)
UPDATE d
SET internal_number = 'MVTA-DET-'
    + CAST(p.detour_year AS NVARCHAR(4)) + '-'
    + RIGHT('0000' + CAST(COALESCE(s.next_value, 1) + p.offset_in_year - 1 AS NVARCHAR(10)), 4)
FROM Detours d
JOIN pending p ON p.id = d.id
LEFT JOIN DetourNumberSequences s WITH (UPDLOCK, HOLDLOCK) ON s.year = p.detour_year;

-- Advance (or create) each affected year's sequence past what was just issued.
MERGE DetourNumberSequences WITH (HOLDLOCK) AS target
USING (
    SELECT
        COALESCE(YEAR(start_date), YEAR(created_at)) AS year,
        MAX(CAST(RIGHT(internal_number, LEN(internal_number) - 14) AS INT)) + 1 AS next_after
    FROM Detours
    WHERE internal_number IS NOT NULL
    GROUP BY COALESCE(YEAR(start_date), YEAR(created_at))
) AS source
  ON target.year = source.year
WHEN MATCHED AND source.next_after > target.next_value THEN
  UPDATE SET next_value = source.next_after
WHEN NOT MATCHED THEN
  INSERT (year, next_value) VALUES (source.year, source.next_after);

COMMIT TRANSACTION;

PRINT 'Gap backfill complete: every Detours row now has an internal_number, sequences advanced past the issued values.';
