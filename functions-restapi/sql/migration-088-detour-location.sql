-- Migration 088: give the authoritative Detour its own location, and undo
-- the intake location that acceptance had been writing into riders_directed.
--
-- Detour Intake captures where the closure IS (location) separately from
-- what is closed (description). Promotion had no Detours column for
-- location and stored it in riders_directed, whose meaning is the opposite -
-- where riders should go INSTEAD. Every promoted Detour therefore read
-- "Riders directed: <closure location>" in the console and the Reports CSV.
--
-- Adds Detours.location, moves the copied value across for every Detour that
-- was promoted from an intake (same id, by design of migration 057), and
-- clears riders_directed only where it still equals the intake location -
-- a value staff have since edited is left alone.

IF OBJECT_ID('dbo.Detours', 'U') IS NULL OR OBJECT_ID('dbo.DetourIntake', 'U') IS NULL
  THROW 50088, 'Migration 088 requires Detours and DetourIntake.', 1;
GO

IF COL_LENGTH('dbo.Detours', 'location') IS NULL ALTER TABLE Detours ADD location NVARCHAR(500) NULL;
GO

UPDATE d
SET d.location = i.location,
    d.riders_directed = CASE WHEN d.riders_directed = i.location THEN NULL ELSE d.riders_directed END
FROM Detours d
JOIN DetourIntake i ON i.id = d.id AND i.status = 'accepted'
WHERE i.location IS NOT NULL AND d.location IS NULL;
GO

PRINT 'Migration 088 applied: Detours.location added; promoted intake locations moved out of riders_directed.';
