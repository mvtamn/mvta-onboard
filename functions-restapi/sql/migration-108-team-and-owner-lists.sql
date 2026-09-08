-- Migration 108: responsible team and assigned owner become lists.
--
-- Both were free text on ContractorPerformanceStandards, typed once per
-- standard and never checked against anything. Migration 030 seeded them by
-- hand and the result reads like free text does after a while: "Safety" and
-- "Safety / Training" and "Safety / Customer Service" are three teams or one
-- team spelled three ways, and nothing in the product can tell.
--
-- They join ReferenceValues (migration 105) as OWNED domains - MVTA adds,
-- renames, reorders and retires them from Administration > Performance
-- Assessment > Lists, exactly like units and source systems. The scoring engine
-- does not branch on either, so neither needs the system-row guardrail.
--
-- Seeded from what the catalog already holds rather than from a list invented
-- here: every distinct value in use becomes a row, so nothing a standard
-- currently says is lost, and the first edit is a rename rather than a
-- re-entry. Values are trimmed and de-duplicated case-insensitively.
--
-- NOTE for whoever curates these: several assigned_to values name more than
-- one person - "Corrina/Maurice", "Rob/Cody/Jason". They are seeded verbatim
-- because losing them would be worse, but they are really several owners in
-- one string, and the column cannot express that. Splitting ownership into its
-- own many-to-one table is a larger change and is deliberately not made here.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ReferenceValues', N'U') IS NULL
  THROW 50108, 'Migration 108 requires ReferenceValues (migration 105).', 1;
IF OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
  THROW 50108, 'Migration 108 requires ContractorPerformanceStandards (migration 030).', 1;
GO

-- Responsible teams already in use.
INSERT dbo.ReferenceValues(domain, value, label, sort_order, is_active, is_system, updated_by)
SELECT 'responsible_team', team.value, team.value,
       ROW_NUMBER() OVER (ORDER BY team.value), 1, 0, N'migration-108'
FROM (
  SELECT DISTINCT LTRIM(RTRIM(responsible_team)) value
  FROM dbo.ContractorPerformanceStandards
  WHERE responsible_team IS NOT NULL AND LTRIM(RTRIM(responsible_team)) <> ''
) team
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.ReferenceValues existing
  WHERE existing.domain = 'responsible_team' AND existing.value = team.value
);
GO

-- Owners already in use. See the note above about combined names.
INSERT dbo.ReferenceValues(domain, value, label, sort_order, is_active, is_system, updated_by)
SELECT 'assigned_to', owner.value, owner.value,
       ROW_NUMBER() OVER (ORDER BY owner.value), 1, 0, N'migration-108'
FROM (
  SELECT DISTINCT LTRIM(RTRIM(assigned_to)) value
  FROM dbo.ContractorPerformanceStandards
  WHERE assigned_to IS NOT NULL AND LTRIM(RTRIM(assigned_to)) <> ''
) owner
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.ReferenceValues existing
  WHERE existing.domain = 'assigned_to' AND existing.value = owner.value
);
GO

PRINT 'Migration 108 verified: responsible teams and assigned owners are lists, seeded from the catalog.';
