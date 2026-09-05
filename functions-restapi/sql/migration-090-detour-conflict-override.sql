-- Migration 090: conflict override on the authoritative Detour.
--
-- CONTEXT.md: "An explicit, reasoned authorization to proceed with a Detour
-- despite an overlapping active Detour at a stop or segment. The warning
-- and reason are retained in the operational audit." Conflicts themselves
-- are computed, not stored (same matcher as intake likely-duplicates, run
-- Detour against Detour). What is stored is the override: who authorised
-- proceeding, when, why, and which conflicting Detours were known at the
-- time - so a new conflict appearing later is not silently covered.

IF OBJECT_ID('dbo.Detours', 'U') IS NULL
  THROW 50090, 'Migration 090 requires Detours.', 1;
GO

IF COL_LENGTH('dbo.Detours', 'conflict_override_reason') IS NULL
BEGIN
  ALTER TABLE Detours ADD conflict_override_reason NVARCHAR(1000) NULL;
  ALTER TABLE Detours ADD conflict_override_by NVARCHAR(200) NULL;
  ALTER TABLE Detours ADD conflict_override_at DATETIME2(3) NULL;
  ALTER TABLE Detours ADD conflict_override_ids NVARCHAR(MAX) NULL; -- JSON array of Detour ids covered by the override
END;
GO

PRINT 'Migration 090 applied: Detours conflict override columns added.';
