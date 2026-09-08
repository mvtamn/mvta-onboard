-- Migration 107: targets, count-scaled bands, ranged amounts, and rolling
-- corrective-action windows.
--
-- The tier model handled four of the contract's penalty shapes and quietly
-- could not express the rest. Each gap below is a real standard in the seeded
-- catalog, and each one was being scored wrongly or not at all.
--
-- 1. THRESHOLD STANDARDS HAVE A TARGET, distinct from their bands.
--    The exhibit states one per threshold standard - 85% on-time, 10
--    complaints a month, 12,000 miles between road calls - and the console had
--    nowhere to put it, so the target lived implicitly in whichever band
--    happened to mean "meets". Worse, assess.ts wrote the literal string
--    'Configured tiers' into PeriodKpiAssessments.target_display, which is
--    what a contractor read on an issued report where the target belongs.
--
-- 2. OCCURRENCE BANDS COULD NOT SCALE WITH THE COUNT.
--    matchTier receives ONE occurrence's quantity, so a band bounded 13-16
--    matched an occurrence of quantity 13, not the thirteenth occurrence of
--    the month. "The thirteenth and each after it cost more" was
--    inexpressible. band_scope = 'running_count' matches each occurrence on
--    its ordinal position within the service month instead.
--
-- 3. SOME PENALTIES ARE A RANGE, NOT A NUMBER.
--    Damage reimbursement runs $2,500-$10,000 per collision: the contract sets
--    the bounds and a person sets the figure on the facts. penalty_amount is
--    one number, so this could only be modelled by picking a number the
--    contract does not state. A band may now carry a range, and the amount for
--    each occurrence is entered by a reviewer in the Performance Assessment
--    module - recorded with who set it and why, because it is a judgement.
--
-- 4. CORRECTIVE ACTION CAN TURN ON A ROLLING WINDOW.
--    "CAP if more than 5 in a rolling 30 days" and "CAP after 3+ in 30 days"
--    are not properties of a band at all - they are counts over a window that
--    crosses month boundaries. triggers_cap is matched per occurrence and
--    could never see them.
--
-- Everything here is nullable and off by default: a standard with no target,
-- no window and no ranged band scores exactly as it did before.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
  THROW 50107, 'Migration 107 requires ContractorPerformanceStandards (migration 030).', 1;
GO

-- 1 and 2 and 4: what the standard itself carries.
IF COL_LENGTH('dbo.ContractorPerformanceStandards','target_value') IS NULL
  ALTER TABLE dbo.ContractorPerformanceStandards ADD target_value FLOAT NULL;
IF COL_LENGTH('dbo.ContractorPerformanceStandards','target_display') IS NULL
  ALTER TABLE dbo.ContractorPerformanceStandards ADD target_display NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.ContractorPerformanceStandards','band_scope') IS NULL
  ALTER TABLE dbo.ContractorPerformanceStandards ADD band_scope NVARCHAR(20) NOT NULL
    CONSTRAINT DF_CPS_BandScope DEFAULT 'per_occurrence';
IF COL_LENGTH('dbo.ContractorPerformanceStandards','cap_window_days') IS NULL
  ALTER TABLE dbo.ContractorPerformanceStandards ADD cap_window_days INT NULL;
IF COL_LENGTH('dbo.ContractorPerformanceStandards','cap_window_threshold') IS NULL
  ALTER TABLE dbo.ContractorPerformanceStandards ADD cap_window_threshold INT NULL;
GO

IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_CPS_BandScope' AND parent_object_id=OBJECT_ID('dbo.ContractorPerformanceStandards'))
  ALTER TABLE dbo.ContractorPerformanceStandards
    ADD CONSTRAINT CK_CPS_BandScope CHECK (band_scope IN ('per_occurrence','running_count'));
-- A window needs both halves or neither: a threshold with no window, or a
-- window with no threshold, describes no rule anyone could apply.
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_CPS_CapWindow' AND parent_object_id=OBJECT_ID('dbo.ContractorPerformanceStandards'))
  ALTER TABLE dbo.ContractorPerformanceStandards
    ADD CONSTRAINT CK_CPS_CapWindow CHECK (
      (cap_window_days IS NULL AND cap_window_threshold IS NULL)
      OR (cap_window_days > 0 AND cap_window_threshold > 0));
GO

-- 3: a band whose amount the contract states as a range.
IF COL_LENGTH('dbo.ContractorStandardTiers','penalty_amount_min') IS NULL
  ALTER TABLE dbo.ContractorStandardTiers ADD penalty_amount_min DECIMAL(12,2) NULL;
IF COL_LENGTH('dbo.ContractorStandardTiers','penalty_amount_max') IS NULL
  ALTER TABLE dbo.ContractorStandardTiers ADD penalty_amount_max DECIMAL(12,2) NULL;
GO

IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_CST_AmountRange' AND parent_object_id=OBJECT_ID('dbo.ContractorStandardTiers'))
  ALTER TABLE dbo.ContractorStandardTiers
    ADD CONSTRAINT CK_CST_AmountRange CHECK (
      (penalty_amount_min IS NULL AND penalty_amount_max IS NULL)
      OR (penalty_amount_min >= 0 AND penalty_amount_max >= penalty_amount_min));
GO

-- 3, continued: the reviewer's figure for one occurrence, and why.
IF COL_LENGTH('dbo.ComplianceOccurrences','assessed_amount') IS NULL
  ALTER TABLE dbo.ComplianceOccurrences ADD assessed_amount DECIMAL(12,2) NULL;
IF COL_LENGTH('dbo.ComplianceOccurrences','assessed_amount_note') IS NULL
  ALTER TABLE dbo.ComplianceOccurrences ADD assessed_amount_note NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.ComplianceOccurrences','assessed_by') IS NULL
  ALTER TABLE dbo.ComplianceOccurrences ADD assessed_by NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.ComplianceOccurrences','assessed_at') IS NULL
  ALTER TABLE dbo.ComplianceOccurrences ADD assessed_at DATETIME2 NULL;
GO

IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE name='CK_CO_AssessedAmount' AND parent_object_id=OBJECT_ID('dbo.ComplianceOccurrences'))
  ALTER TABLE dbo.ComplianceOccurrences
    ADD CONSTRAINT CK_CO_AssessedAmount CHECK (assessed_amount IS NULL OR assessed_amount >= 0);
GO

-- Snapshotted with the period, for the reason everything else is: a target
-- edited later, a band's range widened, or a window changed must not restate a
-- month already issued.
IF OBJECT_ID(N'dbo.AssessmentPeriodStandards', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.AssessmentPeriodStandards','target_value') IS NULL
    ALTER TABLE dbo.AssessmentPeriodStandards ADD target_value FLOAT NULL;
  IF COL_LENGTH('dbo.AssessmentPeriodStandards','target_display') IS NULL
    ALTER TABLE dbo.AssessmentPeriodStandards ADD target_display NVARCHAR(100) NULL;
  IF COL_LENGTH('dbo.AssessmentPeriodStandards','band_scope') IS NULL
    ALTER TABLE dbo.AssessmentPeriodStandards ADD band_scope NVARCHAR(20) NULL;
  IF COL_LENGTH('dbo.AssessmentPeriodStandards','cap_window_days') IS NULL
    ALTER TABLE dbo.AssessmentPeriodStandards ADD cap_window_days INT NULL;
  IF COL_LENGTH('dbo.AssessmentPeriodStandards','cap_window_threshold') IS NULL
    ALTER TABLE dbo.AssessmentPeriodStandards ADD cap_window_threshold INT NULL;
END;
GO

IF OBJECT_ID(N'dbo.AssessmentPeriodTiers', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.AssessmentPeriodTiers','penalty_amount_min') IS NULL
    ALTER TABLE dbo.AssessmentPeriodTiers ADD penalty_amount_min DECIMAL(12,2) NULL;
  IF COL_LENGTH('dbo.AssessmentPeriodTiers','penalty_amount_max') IS NULL
    ALTER TABLE dbo.AssessmentPeriodTiers ADD penalty_amount_max DECIMAL(12,2) NULL;
END;
GO

-- How many occurrences are waiting on a reviewer's figure. A month cannot be
-- read as complete while any remain, and the console has to be able to say so
-- without recomputing.
IF OBJECT_ID(N'dbo.PeriodKpiAssessments', N'U') IS NOT NULL
   AND COL_LENGTH('dbo.PeriodKpiAssessments','awaiting_amount_count') IS NULL
  ALTER TABLE dbo.PeriodKpiAssessments ADD awaiting_amount_count INT NOT NULL
    CONSTRAINT DF_PKA_AwaitingAmount DEFAULT 0;
GO

-- Seed the targets the exhibit states for the three scored threshold
-- standards. Written only where nobody has set one, so a later edit stands.
UPDATE dbo.ContractorPerformanceStandards SET target_value = 0.85, target_display = N'85% or above'
  WHERE code = 'OTP_FIXED_ROUTE' AND target_value IS NULL;
UPDATE dbo.ContractorPerformanceStandards SET target_value = 12000, target_display = N'12,000 miles or above'
  WHERE code = 'AVG_MILES_ROAD_CALLS' AND target_value IS NULL;
UPDATE dbo.ContractorPerformanceStandards SET target_value = 11, target_display = N'Under 11 a month'
  WHERE code = 'OPERATOR_CONDUCT' AND target_value IS NULL;
GO

PRINT 'Migration 107 verified: targets, count-scaled bands, ranged amounts and rolling CAP windows.';
