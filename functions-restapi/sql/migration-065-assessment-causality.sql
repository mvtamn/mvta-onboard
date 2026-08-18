SET XACT_ABORT ON;
GO

-- Preserve source input used to explain an assessment. metric_value and
-- unit_quantity remain the assessable input after contractual exclusions.
IF COL_LENGTH('dbo.PeriodKpiAssessments','raw_metric_value') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD raw_metric_value FLOAT NULL;
IF COL_LENGTH('dbo.PeriodKpiAssessments','raw_occurrence_count') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD raw_occurrence_count INT NOT NULL CONSTRAINT DF_PKA_RawOccurrenceCount DEFAULT 0;
IF COL_LENGTH('dbo.PeriodKpiAssessments','raw_unit_quantity') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD raw_unit_quantity FLOAT NOT NULL CONSTRAINT DF_PKA_RawUnitQuantity DEFAULT 0;
IF COL_LENGTH('dbo.PeriodKpiAssessments','excluded_metric_value') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD excluded_metric_value FLOAT NULL;
IF COL_LENGTH('dbo.PeriodKpiAssessments','excluded_occurrence_count') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD excluded_occurrence_count INT NOT NULL CONSTRAINT DF_PKA_ExcludedOccurrenceCount DEFAULT 0;
IF COL_LENGTH('dbo.PeriodKpiAssessments','excluded_unit_quantity') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD excluded_unit_quantity FLOAT NOT NULL CONSTRAINT DF_PKA_ExcludedUnitQuantity DEFAULT 0;
IF COL_LENGTH('dbo.PeriodKpiAssessments','excluded_source_refs_json') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD excluded_source_refs_json NVARCHAR(MAX) NOT NULL CONSTRAINT DF_PKA_ExcludedSourceRefs DEFAULT N'[]';
IF COL_LENGTH('dbo.PeriodKpiAssessments','binding_amount') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD binding_amount DECIMAL(12,2) NULL;
IF COL_LENGTH('dbo.PeriodKpiAssessments','binding_reason') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD binding_reason NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.PeriodKpiAssessments','binding_decision_at') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD binding_decision_at DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_PKA_NonNegativeAmounts' AND parent_object_id=OBJECT_ID('dbo.PeriodKpiAssessments'))
    ALTER TABLE dbo.PeriodKpiAssessments ADD CONSTRAINT CK_PKA_NonNegativeAmounts CHECK (base_amount >= 0 AND relief_amount >= 0 AND proposed_amount >= 0 AND (final_amount IS NULL OR final_amount >= 0) AND (recommended_amount IS NULL OR recommended_amount >= 0) AND (binding_amount IS NULL OR binding_amount >= 0));
GO

PRINT 'Migration 065 verified: assessment source input and historical monetary causality are preserved.';
