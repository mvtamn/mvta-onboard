-- Migration 024: Internal detour numbering (MVTA-DET-YYYY-####).
--
-- Part B10 of detour-module-consolidated-plan.md. A system-generated,
-- never-reused internal reference number, distinct from the existing
-- free-text `number` column (which stays exactly as-is - it holds things
-- like "951", "Operator Message", "993 & 994" and is staff-entered, not
-- generated). `####` resets to 0001 each year.
--
-- WHY A SEQUENCE TABLE AND NOT MAX()+1: two staff creating detours at the
-- same moment would both read the same MAX() and collide. The allocation in
-- detoursCreate.ts does a single atomic MERGE ... WITH (HOLDLOCK) against
-- this table, which both bootstraps a new year's row and increments an
-- existing one in one statement - no read-then-write gap either way.
--
-- WHY internal_number IS NULLABLE: Detours already holds rows, so a NOT NULL
-- column with no default cannot be added. The order is add-nullable ->
-- backfill (below) -> optionally tighten to NOT NULL in a later migration
-- once every environment is confirmed backfilled. It is deliberately left
-- nullable here rather than tightened in the same migration, so a partially
-- backfilled environment fails loudly on inspection instead of blocking the
-- migration itself.

CREATE TABLE DetourNumberSequences (
    year        INT NOT NULL PRIMARY KEY,
    next_value  INT NOT NULL DEFAULT 1
);
GO

ALTER TABLE Detours ADD internal_number NVARCHAR(20) NULL;
GO

-- Uniqueness is enforced only over assigned numbers - the filtered index
-- lets pre-backfill NULLs coexist. Numbers are never reused or reassigned,
-- including for soft-deleted rows (is_deleted = 1 is NOT excluded here on
-- purpose: a retired number must stay retired, since it may already appear
-- in a sent notification email).
CREATE UNIQUE INDEX UX_Detours_InternalNumber ON Detours (internal_number)
    WHERE internal_number IS NOT NULL;
GO

-- Backfill existing rows. Year comes from start_date when set, falling back
-- to created_at for open-ended/undated rows (start_date is nullable). Within
-- a year, numbers are assigned in created_at order so the sequence reflects
-- the order detours were actually entered.
WITH numbered AS (
    SELECT
        id,
        COALESCE(YEAR(start_date), YEAR(created_at)) AS detour_year,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(YEAR(start_date), YEAR(created_at))
            ORDER BY created_at, id
        ) AS seq
    FROM Detours
    WHERE internal_number IS NULL
)
UPDATE d
SET internal_number = 'MVTA-DET-'
    + CAST(n.detour_year AS NVARCHAR(4)) + '-'
    + RIGHT('0000' + CAST(n.seq AS NVARCHAR(10)), 4)
FROM Detours d
JOIN numbered n ON n.id = d.id;
GO

-- Seed the sequence table from what the backfill just consumed, so the first
-- genuinely new detour in each year continues the run instead of colliding
-- with a backfilled number. Years with no existing rows simply get no row
-- here and are bootstrapped by the MERGE on first use.
INSERT INTO DetourNumberSequences (year, next_value)
SELECT
    COALESCE(YEAR(start_date), YEAR(created_at)) AS year,
    COUNT(*) + 1                                 AS next_value
FROM Detours
WHERE internal_number IS NOT NULL
GROUP BY COALESCE(YEAR(start_date), YEAR(created_at));
GO

PRINT 'Migration 024 applied: DetourNumberSequences created, Detours.internal_number added, existing rows backfilled.';
