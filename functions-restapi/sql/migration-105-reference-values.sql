-- Migration 105: every picker in the standards configurator reads from a
-- table, and an Agreement names the contract it comes from.
--
-- The console's dropdowns were literal arrays in TypeScript: units, source
-- systems, condition codes, penalty bases, tier labels. Changing one meant a
-- deploy, and the labels were the code's words rather than the contract's.
--
-- ReferenceValues backs all of them. Two classes of row, because the domains
-- are not alike:
--
--   is_system = 0  vocabulary MVTA owns - units, source systems, condition
--                  codes, responsible teams, priorities. Add, rename, reorder,
--                  retire, all from the console.
--
--   is_system = 1  values the scoring engine BRANCHES on - penalty_basis,
--                  tier_label, measurement_source, standard_type, direction.
--                  Renameable, reorderable, retirable; not addable or
--                  deletable. computePenalty() switches exhaustively over the
--                  penalty bases and a TypeScript `never` check guarantees each
--                  one has arithmetic; a basis invented in a form would have
--                  none. The label is presentation and is yours - the value is
--                  a contract with the code.
--
-- Retiring is is_active = 0, never a delete: a row that already scored a month
-- has to keep resolving. Inactive values stay out of new pickers and still
-- render wherever they were used.
--
-- severity_order makes tier ranking data. assess.ts ranked tiers with a
-- hardcoded map (meets 0, warning 1, tier1 2, tier2 3) that returned undefined
-- for anything else - and `undefined > undefined` is false, so an unrecognised
-- tier silently never escalated. As a column, a fifth tier is a row rather than
-- a code change, and it is snapshotted per period below so a later reordering
-- cannot change what a finalized month already scored.
--
-- PerformanceAgreements gains contract_number and exhibit_reference so the
-- console can name the governing document from data. The catalog is the
-- Contractor Performance Standards; "Attachment G" is what THIS agreement
-- happens to call its exhibit, and hardcoding it in the product was wrong.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
  THROW 50105, 'Migration 105 requires ContractorPerformanceStandards (migration 030).', 1;
GO

IF OBJECT_ID(N'dbo.ReferenceValues', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReferenceValues (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        domain NVARCHAR(50) NOT NULL,
        value NVARCHAR(50) NOT NULL,
        label NVARCHAR(200) NOT NULL,
        description NVARCHAR(500) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        -- tier_label only: which tier outranks which when several bands match.
        severity_order INT NULL,
        is_active BIT NOT NULL DEFAULT 1,
        -- 1 = the scoring engine branches on this value; relabel, never invent.
        is_system BIT NOT NULL DEFAULT 0,
        updated_by NVARCHAR(200) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_RV_DomainValue UNIQUE (domain, value),
        CONSTRAINT CK_RV_Severity CHECK (severity_order IS NULL OR domain = 'tier_label'),
        CONSTRAINT CK_RV_Value CHECK (LEN(LTRIM(RTRIM(value))) > 0),
        CONSTRAINT CK_RV_Label CHECK (LEN(LTRIM(RTRIM(label))) > 0)
    );
    CREATE INDEX IX_RV_Domain ON dbo.ReferenceValues(domain, is_active) INCLUDE (value, label, sort_order);
END;
GO

MERGE dbo.ReferenceValues AS target
USING (VALUES
 -- Vocabulary MVTA owns.
 (N'unit',N'percent',N'Percent (%)',N'Stored as a ratio; shown and entered as a percentage.',1,NULL,0),
 (N'unit',N'occurrences',N'Occurrences',NULL,2,NULL,0),
 (N'unit',N'miles',N'Miles',NULL,3,NULL,0),
 (N'unit',N'vehicles',N'Vehicles',NULL,4,NULL,0),
 (N'unit',N'vehicle-days',N'Vehicle-days',NULL,5,NULL,0),
 (N'unit',N'days',N'Days',NULL,6,NULL,0),
 (N'unit',N'weeks',N'Weeks',NULL,7,NULL,0),
 (N'source_system',N'Nexus',N'Nexus (Trackit)',N'Customer contacts and operator conduct complaints.',1,NULL,0),
 (N'source_system',N'Asset Works M5',N'Asset Works M5',N'Fleet maintenance, road calls and vehicle availability.',2,NULL,0),
 (N'condition_code',N'LAST_TRIP_OF_DAY',N'Last trip of the service day',N'Narrows a band to the final scheduled trip.',1,NULL,0),
 (N'condition_code',N'REPORTING_LATE',N'Not reported within the required timeframe',NULL,2,NULL,0),
 (N'priority',N'High',N'High',NULL,1,NULL,0),
 (N'priority',N'Medium',N'Medium',NULL,2,NULL,0),
 (N'priority',N'Low',N'Low',NULL,3,NULL,0),
 (N'priority',N'NA',N'Not applicable',NULL,4,NULL,0),
 -- Values the scoring engine branches on.
 (N'penalty_basis',N'none',N'No penalty',N'The band is recorded but charges nothing.',1,NULL,1),
 (N'penalty_basis',N'flat',N'Flat amount for the month',N'Charged once, however many times it happened.',2,NULL,1),
 (N'penalty_basis',N'per_unit',N'Per occurrence',N'Multiplied by the number of occurrences.',3,NULL,1),
 (N'penalty_basis',N'per_unit_per_day',N'Per occurrence, per day',N'Multiplied by occurrences and by how many days each lasted.',4,NULL,1),
 (N'penalty_basis',N'per_day',N'Per day',N'Multiplied by how many days it lasted.',5,NULL,1),
 (N'penalty_basis',N'per_week',N'Per occurrence, per week',N'Multiplied by occurrences and by each started week.',6,NULL,1),
 (N'tier_label',N'meets',N'Meets the standard',NULL,1,0,1),
 (N'tier_label',N'warning',N'Warning',NULL,2,1,1),
 (N'tier_label',N'tier1',N'Tier 1 penalty',NULL,3,2,1),
 (N'tier_label',N'tier2',N'Tier 2 penalty',NULL,4,3,1),
 (N'measurement_source',N'api_feed',N'Ingested from a feed',N'A feed this application reads directly.',1,NULL,1),
 (N'measurement_source',N'onboard_compliance',N'Raised by OnBoard compliance',N'Occurrences OnBoard raises from its own modules.',2,NULL,1),
 (N'measurement_source',N'manual_entry',N'Entered by hand',N'Somebody types the month''s figure in.',3,NULL,1),
 (N'measurement_source',N'structured_import',N'Transcribed from another system',N'Read off another system''s structured report.',4,NULL,1),
 (N'standard_type',N'occurrence',N'Counted events',N'Each one logged and charged.',1,NULL,1),
 (N'standard_type',N'threshold',N'Monthly value',N'One number, scored against bands.',2,NULL,1),
 (N'direction',N'lower_is_better',N'Lower is better',N'A rising number is worse.',1,NULL,1),
 (N'direction',N'higher_is_better',N'Higher is better',N'A falling number is worse.',2,NULL,1)
) AS source(domain,value,label,description,sort_order,severity_order,is_system)
ON target.domain = source.domain AND target.value = source.value
-- An existing row keeps the label and ordering MVTA gave it; only the
-- machine-meaningful flags are re-asserted, so re-running never undoes an edit.
WHEN MATCHED THEN UPDATE SET is_system = source.is_system, updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT(domain,value,label,description,sort_order,severity_order,is_system,updated_by)
 VALUES(source.domain,source.value,source.label,source.description,source.sort_order,source.severity_order,source.is_system,N'migration-105');
GO

-- Snapshot the ranking with the period, for the same reason the tiers and the
-- resolver are snapshotted: reordering tiers later must not change what an
-- already-issued month scored.
IF OBJECT_ID(N'dbo.AssessmentPeriodTiers', N'U') IS NOT NULL
   AND COL_LENGTH('dbo.AssessmentPeriodTiers','severity_order') IS NULL
  ALTER TABLE dbo.AssessmentPeriodTiers ADD severity_order INT NULL;
GO

IF OBJECT_ID(N'dbo.AssessmentPeriodTiers', N'U') IS NOT NULL
  UPDATE snapshot
  SET severity_order = reference.severity_order
  FROM dbo.AssessmentPeriodTiers snapshot
  JOIN dbo.ReferenceValues reference
    ON reference.domain = 'tier_label' AND reference.value = snapshot.tier_label
  WHERE snapshot.severity_order IS NULL;
GO

-- The governing document, named from data. "Attachment G" is this agreement's
-- exhibit, not a fact about the product.
IF OBJECT_ID(N'dbo.PerformanceAgreements', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.PerformanceAgreements','contract_number') IS NULL
    ALTER TABLE dbo.PerformanceAgreements ADD contract_number NVARCHAR(100) NULL;
  IF COL_LENGTH('dbo.PerformanceAgreements','exhibit_reference') IS NULL
    ALTER TABLE dbo.PerformanceAgreements ADD exhibit_reference NVARCHAR(200) NULL;
END;
GO

PRINT 'Migration 105 verified: reference values back every picker, tier ranking is data, and an Agreement names its contract.';
