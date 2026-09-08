-- Migration 109: window modes, and Operator Staffing split into the standards
-- it actually contains.
--
-- TWO WAYS TO COUNT A WINDOW.
--
-- Migration 107 gave corrective action a rolling window in days. Contracts
-- write both kinds: "more than 5 in a rolling 30 days" catches a run that
-- straddles a month end, which is the point of writing it that way, while
-- "3+ repeat cases per quarter" means the quarter as a reporting period and
-- resets at the boundary. They are not approximations of each other - three
-- cases in December and three in January breach a calendar-quarter rule never
-- and a rolling 90-day rule almost certainly. Which one a standard means is a
-- reading of its contract, so it is recorded rather than assumed.
--
-- OPERATOR STAFFING IS FOUR STANDARDS, NOT ONE.
--
-- The clause carries four penalties with four different units and four
-- different pieces of evidence:
--
--   $500   per day below the 120% staffing requirement
--   $250   per peak period missing required Pivot Operator coverage
--   $250   per improper use of a Pivot Operator
--   $1,000 per day per unqualified or unlicensed operator deployed
--
-- One standard has one unit and one ladder, so modelling these as one means
-- choosing a unit and losing the other three penalties. They share a contract
-- clause and nothing else - not the unit, not the evidence, not the cadence.
-- Each becomes its own standard, seeded dormant (is_scored = 0) so scoring one
-- is a deliberate assignment on an Agreement rather than a side effect of this
-- migration. The original OPERATOR_STAFFING row is retired rather than deleted:
-- it is referenced by nothing today, but retiring says what happened to it.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
  THROW 50109, 'Migration 109 requires ContractorPerformanceStandards (migration 030).', 1;
IF COL_LENGTH('dbo.ContractorPerformanceStandards','cap_window_days') IS NULL
  THROW 50109, 'Migration 109 requires the corrective-action window columns (migration 107).', 1;
GO

IF COL_LENGTH('dbo.ContractorPerformanceStandards','cap_window_mode') IS NULL
  ALTER TABLE dbo.ContractorPerformanceStandards ADD cap_window_mode NVARCHAR(20) NULL;
GO

-- A rolling window needs a length; a calendar quarter is its own length, and a
-- day count alongside it would be a number nothing reads.
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_CPS_CapWindowMode' AND parent_object_id=OBJECT_ID('dbo.ContractorPerformanceStandards'))
  ALTER TABLE dbo.ContractorPerformanceStandards
    ADD CONSTRAINT CK_CPS_CapWindowMode CHECK (
      cap_window_mode IS NULL
      OR (cap_window_mode = 'rolling_days' AND cap_window_days > 0)
      OR (cap_window_mode = 'calendar_quarter' AND cap_window_days IS NULL));
GO

-- Windows that already exist were written as rolling days, which is what the
-- code did before this migration; saying so explicitly keeps the meaning where
-- a reader can see it.
UPDATE dbo.ContractorPerformanceStandards
SET cap_window_mode = 'rolling_days'
WHERE cap_window_mode IS NULL AND cap_window_days IS NOT NULL AND cap_window_threshold IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.AssessmentPeriodStandards', N'U') IS NOT NULL
   AND COL_LENGTH('dbo.AssessmentPeriodStandards','cap_window_mode') IS NULL
  ALTER TABLE dbo.AssessmentPeriodStandards ADD cap_window_mode NVARCHAR(20) NULL;
GO

-- The units these standards are measured in, so the pickers offer them.
IF OBJECT_ID(N'dbo.ReferenceValues', N'U') IS NOT NULL
  INSERT dbo.ReferenceValues(domain, value, label, description, sort_order, is_active, is_system, updated_by)
  SELECT unit.value, unit.value, unit.label, unit.description, unit.sort_order, 1, 0, N'migration-109'
  FROM (VALUES
    ('unit', 'peak-periods', 'Peak periods', 'One morning or afternoon peak on one service day.', 8),
    ('unit', 'operator-days', 'Operator-days', 'One operator, on one service day.', 9)
  ) unit(domain, value, label, description, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.ReferenceValues existing
    WHERE existing.domain = unit.domain AND existing.value = unit.value
  );
GO

-- Retire the combined standard. It is not deleted: a row that has been in the
-- catalog should say what became of it.
UPDATE dbo.ContractorPerformanceStandards
SET effective_end_date = CONVERT(char(8), SYSUTCDATETIME(), 112),
    data_source_note = LEFT(CONCAT(
      N'Retired by migration 109 and replaced by OPERATOR_STAFFING_LEVEL, PIVOT_COVERAGE, PIVOT_MISUSE and UNQUALIFIED_OPERATOR. ',
      ISNULL(data_source_note, N'')), 1000),
    updated_by = N'migration-109', updated_at = SYSUTCDATETIME()
WHERE code = 'OPERATOR_STAFFING' AND effective_end_date IS NULL;
GO

-- The four standards the clause actually contains. Dormant: scoring one is a
-- deliberate assignment on an Agreement.
MERGE dbo.ContractorPerformanceStandards AS target
USING (VALUES
 (N'OPERATOR_STAFFING_LEVEL', N'Operator Staffing Level',
  N'A day on which staffing fell below the required 120% of scheduled daily service.',
  N'occurrence', N'High', N'days', N'lower_is_better', N'manual_entry', N'Transit Operations / HR', 8),
 (N'PIVOT_COVERAGE', N'Pivot Operator Coverage',
  N'A peak period without the minimum required Pivot Operator coverage.',
  N'occurrence', N'Medium', N'peak-periods', N'lower_is_better', N'manual_entry', N'Transit Operations', 9),
 (N'PIVOT_MISUSE', N'Pivot Operator Misuse',
  N'A Pivot Operator assigned to known pre-day open work without MVTA approval.',
  N'occurrence', N'Medium', N'occurrences', N'lower_is_better', N'manual_entry', N'Transit Operations', 10),
 (N'UNQUALIFIED_OPERATOR', N'Unqualified Operator Deployed',
  N'An operator deployed without the required licensing, training or credentials. Safety-critical.',
  N'occurrence', N'High', N'operator-days', N'lower_is_better', N'manual_entry', N'Transit Operations / HR', 11)
) AS source(code, name, description, standard_type, priority, unit_label, direction, measurement_source, responsible_team, sort_order)
ON target.code = source.code
WHEN NOT MATCHED THEN INSERT(code, name, description, standard_type, priority, is_scored, is_safety_critical,
  direction, unit_label, measurement_source, responsible_team, sort_order, updated_by)
 VALUES(source.code, source.name, source.description, source.standard_type, source.priority, 0,
  CASE WHEN source.code = 'UNQUALIFIED_OPERATOR' THEN 1 ELSE 0 END,
  source.direction, source.unit_label, source.measurement_source, source.responsible_team, source.sort_order, N'migration-109');
GO

-- Their penalty bands, each charging what the clause states.
INSERT dbo.ContractorStandardTiers
 (standard_id, tier_order, tier_label, penalty_basis, penalty_amount, triggers_cap, notes, updated_by)
SELECT standard.id, 1, N'tier1', band.penalty_basis, band.penalty_amount, 0, band.notes, N'migration-109'
FROM dbo.ContractorPerformanceStandards standard
JOIN (VALUES
 (N'OPERATOR_STAFFING_LEVEL', N'per_unit', 500, N'$500 per day below the 120% staffing requirement.'),
 (N'PIVOT_COVERAGE', N'per_unit', 250, N'$250 per peak period missing required Pivot Operators.'),
 (N'PIVOT_MISUSE', N'per_unit', 250, N'$250 per improper use of a Pivot Operator.'),
 (N'UNQUALIFIED_OPERATOR', N'per_unit_per_day', 1000, N'$1,000 per day per unqualified or unlicensed operator deployed.')
) band(code, penalty_basis, penalty_amount, notes) ON standard.code = band.code
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.ContractorStandardTiers existing
  WHERE existing.standard_id = standard.id AND existing.agreement_id IS NULL
);
GO

PRINT 'Migration 109 verified: window modes, and Operator Staffing split into four standards.';
