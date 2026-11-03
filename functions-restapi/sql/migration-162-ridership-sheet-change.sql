-- Migration 162: a relief operator or bus change on a Count Sheet (ADR 0043).
--
-- Check-in staff assign operators to blocks in Avail on the day, and the bus
-- joins when the operator logs into the MDT - after the desk printed the sheet
-- the evening before. So the sheet's operator and bus are handwritten, and OCC
-- keys them from the sheet with Avail's pull-out as the pre-fill. A block can
-- change hands or buses part way: a relief operator, or a bus swapped out.
-- The printed sheet now has a line for it ("Relief or bus change: from trip #
-- __, operator, bus"), and the sheet records it here:
--
--   change_from_trip_id  - the Dispatch Log trip the change applies from; the
--                          trips before it ran with the header's operator and
--                          bus. Never the sheet's first trip (checked by the
--                          API, which knows the order).
--   change_operator_name, change_operator_id, change_bus
--                        - who or which bus took over. A bus-only swap leaves
--                          the operator blank, and a relief on the same bus
--                          leaves the bus blank: the header's value carries on.
--
-- One change per sheet, matching the one line on the paper. All four are NULL
-- when nothing changed; a change names its trip and at least one of the three.
--
-- The API reads these columns only once they exist, so the code can deploy
-- before this migration is applied: until then a sheet with a change written
-- on it cannot be saved (503 naming this migration), and every other save works.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.RidershipSheets', 'U') IS NULL
  THROW 50162, 'Migration 162 requires RidershipSheets (migration 153).', 1;
GO

IF COL_LENGTH('dbo.RidershipSheets', 'change_from_trip_id') IS NULL
  ALTER TABLE dbo.RidershipSheets ADD
    change_from_trip_id   NVARCHAR(100) NULL,
    change_operator_name  NVARCHAR(200) NULL,
    change_operator_id    NVARCHAR(20)  NULL,   -- Avail logon_id, or as written on the sheet
    change_bus            NVARCHAR(20)  NULL;   -- vehicle label
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RidershipSheets_Change')
  ALTER TABLE dbo.RidershipSheets ADD CONSTRAINT CK_RidershipSheets_Change CHECK (
    (change_from_trip_id IS NULL AND change_operator_name IS NULL AND change_operator_id IS NULL AND change_bus IS NULL)
    OR (change_from_trip_id IS NOT NULL AND COALESCE(change_operator_name, change_operator_id, change_bus) IS NOT NULL)
  );
GO

PRINT 'Migration 162: RidershipSheets records a relief operator or bus change.';
GO
