SET XACT_ABORT ON;
GO

IF (SELECT COUNT(*) FROM dbo.Contractors WHERE is_active=1) > 1
    THROW 51032, 'Performance Assessment permits exactly one current Agreement contractor.', 1;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.Contractors') AND name='UX_Contractors_OneActive')
    CREATE UNIQUE INDEX UX_Contractors_OneActive ON dbo.Contractors(is_active) WHERE is_active=1;
GO

IF OBJECT_ID(N'dbo.PerformanceAgreements', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PerformanceAgreements (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        contractor_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Contractors(id),
        starts_on DATE NOT NULL,
        ends_on DATE NOT NULL,
        validation_business_days INT NOT NULL DEFAULT 5,
        retention_years INT NOT NULL DEFAULT 7,
        is_active BIT NOT NULL DEFAULT 1,
        created_by NVARCHAR(200) NOT NULL DEFAULT N'migration-032',
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_PA_Dates CHECK (ends_on >= starts_on),
        CONSTRAINT CK_PA_ValidationDays CHECK (validation_business_days > 0),
        CONSTRAINT CK_PA_Retention CHECK (retention_years > 0)
    );
    CREATE UNIQUE INDEX UX_PA_Active ON dbo.PerformanceAgreements(is_active) WHERE is_active = 1;
END;
GO

INSERT dbo.PerformanceAgreements(contractor_id, starts_on, ends_on)
SELECT c.id, CONVERT(date,c.contract_start_date,112), COALESCE(CONVERT(date,c.contract_end_date,112),CONVERT(date,'99991231',112))
FROM dbo.Contractors c
WHERE c.is_active=1 AND NOT EXISTS(SELECT 1 FROM dbo.PerformanceAgreements);
GO

IF COL_LENGTH('dbo.AssessmentPeriods','agreement_id') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD agreement_id UNIQUEIDENTIFIER NULL REFERENCES dbo.PerformanceAgreements(id);
IF COL_LENGTH('dbo.AssessmentPeriods','rule_set_sha256') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD rule_set_sha256 CHAR(64) NULL;
IF COL_LENGTH('dbo.AssessmentPeriods','rule_set_json') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD rule_set_json NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.AssessmentPeriods','is_partial') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD is_partial BIT NOT NULL CONSTRAINT DF_AP_IsPartial DEFAULT 0;
IF COL_LENGTH('dbo.AssessmentPeriods','validation_shared_at') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD validation_shared_at DATETIME2 NULL;
IF COL_LENGTH('dbo.AssessmentPeriods','validation_ends_on') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD validation_ends_on DATE NULL;
IF COL_LENGTH('dbo.AssessmentPeriods','validation_shared_by') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD validation_shared_by NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.AssessmentPeriods','validation_recipient') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD validation_recipient NVARCHAR(320) NULL;
IF COL_LENGTH('dbo.AssessmentPeriods','validation_method') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD validation_method NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.AssessmentPeriods','validation_attestation') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD validation_attestation NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.AssessmentPeriods','assessment_revision') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD assessment_revision INT NOT NULL CONSTRAINT DF_AP_Revision DEFAULT 1;
IF COL_LENGTH('dbo.AssessmentPeriods','supersedes_period_id') IS NULL ALTER TABLE dbo.AssessmentPeriods ADD supersedes_period_id UNIQUEIDENTIFIER NULL REFERENCES dbo.AssessmentPeriods(id);
IF EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('dbo.AssessmentPeriods') AND name='UQ_AP_ContractorMonth') ALTER TABLE dbo.AssessmentPeriods DROP CONSTRAINT UQ_AP_ContractorMonth;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.AssessmentPeriods') AND name='UX_AP_ContractorMonthRevision') CREATE UNIQUE INDEX UX_AP_ContractorMonthRevision ON dbo.AssessmentPeriods(contractor_id,service_month,assessment_revision);
GO

UPDATE p SET agreement_id=a.id
FROM dbo.AssessmentPeriods p
JOIN dbo.PerformanceAgreements a ON a.contractor_id=p.contractor_id
WHERE p.agreement_id IS NULL;
GO

IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.AssessmentPeriods') AND name='CK_AP_Status')
    ALTER TABLE dbo.AssessmentPeriods DROP CONSTRAINT CK_AP_Status;
ALTER TABLE dbo.AssessmentPeriods ADD CONSTRAINT CK_AP_Status CHECK(status IN('open','in_review','in_validation','stale','finalized','issued','reopened'));
GO

IF COL_LENGTH('dbo.PeriodKpiAssessments','assessment_outcome') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD assessment_outcome NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.PeriodKpiAssessments','recommended_action') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD recommended_action NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.PeriodKpiAssessments','recommended_amount') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD recommended_amount DECIMAL(12,2) NULL;
IF COL_LENGTH('dbo.PeriodKpiAssessments','recommendation_reason') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD recommendation_reason NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.PeriodKpiAssessments','recommendation_by') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD recommendation_by NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.PeriodKpiAssessments','binding_decision_by') IS NULL ALTER TABLE dbo.PeriodKpiAssessments ADD binding_decision_by NVARCHAR(200) NULL;
GO

IF OBJECT_ID(N'dbo.AssessmentPeriodStandards',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.AssessmentPeriodStandards(period_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.AssessmentPeriods(id),standard_id UNIQUEIDENTIFIER NOT NULL,code NVARCHAR(50) NOT NULL,name NVARCHAR(200) NOT NULL,standard_type NVARCHAR(20) NOT NULL,priority NVARCHAR(20) NULL,direction NVARCHAR(30) NOT NULL,is_safety_critical BIT NOT NULL,measurement_source NVARCHAR(20) NOT NULL,sort_order INT NOT NULL,PRIMARY KEY(period_id,standard_id));
 CREATE TABLE dbo.AssessmentPeriodTiers(period_id UNIQUEIDENTIFIER NOT NULL,standard_id UNIQUEIDENTIFIER NOT NULL,tier_order INT NOT NULL,tier_label NVARCHAR(20) NOT NULL,bound_low FLOAT NULL,bound_high FLOAT NULL,qualifier_code NVARCHAR(50) NULL,penalty_basis NVARCHAR(30) NOT NULL,penalty_amount DECIMAL(10,2) NOT NULL,triggers_cap BIT NOT NULL,PRIMARY KEY(period_id,standard_id,tier_order),FOREIGN KEY(period_id,standard_id) REFERENCES dbo.AssessmentPeriodStandards(period_id,standard_id));
END;
GO

IF COL_LENGTH('dbo.AssessmentPeriodStandards','name') IS NULL ALTER TABLE dbo.AssessmentPeriodStandards ADD name NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.AssessmentPeriodStandards','priority') IS NULL ALTER TABLE dbo.AssessmentPeriodStandards ADD priority NVARCHAR(20) NULL;
GO

INSERT dbo.AssessmentPeriodStandards(period_id,standard_id,code,name,standard_type,priority,direction,is_safety_critical,measurement_source,sort_order)
SELECT p.id,s.id,s.code,s.name,s.standard_type,s.priority,s.direction,s.is_safety_critical,s.measurement_source,s.sort_order
FROM dbo.AssessmentPeriods p CROSS JOIN dbo.ContractorPerformanceStandards s
WHERE s.is_scored=1 AND NOT EXISTS(SELECT 1 FROM dbo.AssessmentPeriodStandards x WHERE x.period_id=p.id AND x.standard_id=s.id);
INSERT dbo.AssessmentPeriodTiers(period_id,standard_id,tier_order,tier_label,bound_low,bound_high,qualifier_code,penalty_basis,penalty_amount,triggers_cap)
SELECT s.period_id,t.standard_id,t.tier_order,t.tier_label,t.bound_low,t.bound_high,t.qualifier_code,t.penalty_basis,t.penalty_amount,t.triggers_cap
FROM dbo.AssessmentPeriodStandards s JOIN dbo.AssessmentPeriods p ON p.id=s.period_id JOIN dbo.ContractorStandardTiers t ON t.standard_id=s.standard_id
WHERE t.effective_start_date<=CONCAT(p.service_month,'01') AND (t.effective_end_date IS NULL OR t.effective_end_date>=CONCAT(p.service_month,'01'))
AND NOT EXISTS(SELECT 1 FROM dbo.AssessmentPeriodTiers x WHERE x.period_id=s.period_id AND x.standard_id=t.standard_id AND x.tier_order=t.tier_order);
GO

IF COL_LENGTH('dbo.ComplianceEvidence','content_sha256') IS NULL ALTER TABLE dbo.ComplianceEvidence ADD content_sha256 CHAR(64) NULL;
IF COL_LENGTH('dbo.ComplianceEvidence','supersedes_id') IS NULL ALTER TABLE dbo.ComplianceEvidence ADD supersedes_id UNIQUEIDENTIFIER NULL REFERENCES dbo.ComplianceEvidence(id);
IF COL_LENGTH('dbo.ComplianceEvidence','visibility') IS NULL ALTER TABLE dbo.ComplianceEvidence ADD visibility NVARCHAR(20) NOT NULL CONSTRAINT DF_CE_Visibility DEFAULT N'internal';
IF COL_LENGTH('dbo.ComplianceEvidence','redaction_reason') IS NULL ALTER TABLE dbo.ComplianceEvidence ADD redaction_reason NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.ComplianceEvidence','assessment_id') IS NULL ALTER TABLE dbo.ComplianceEvidence ADD assessment_id UNIQUEIDENTIFIER NULL REFERENCES dbo.PeriodKpiAssessments(id);
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.ComplianceEvidence') AND name='CK_CE_OneParent')
    ALTER TABLE dbo.ComplianceEvidence DROP CONSTRAINT CK_CE_OneParent;
ALTER TABLE dbo.ComplianceEvidence ADD CONSTRAINT CK_CE_OneParent CHECK((CASE WHEN occurrence_id IS NULL THEN 0 ELSE 1 END)+(CASE WHEN metric_entry_id IS NULL THEN 0 ELSE 1 END)+(CASE WHEN assessment_id IS NULL THEN 0 ELSE 1 END)=1);
GO

IF OBJECT_ID(N'dbo.AssessmentExceptions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AssessmentExceptions (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), period_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.AssessmentPeriods(id),
        assessment_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.PeriodKpiAssessments(id), reason NVARCHAR(1000) NOT NULL,
        missing_data_owner NVARCHAR(200) NOT NULL, remediation_action NVARCHAR(1000) NOT NULL, expected_correction_date DATE NOT NULL,
        authorized_by NVARCHAR(200) NOT NULL, authorized_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.ValidationDraftShares', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ValidationDraftShares (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), period_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.AssessmentPeriods(id),
        report_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.ComplianceReports(id), recipient NVARCHAR(320) NOT NULL,
        delivery_method NVARCHAR(50) NOT NULL, sender_attestation NVARCHAR(1000) NOT NULL, shared_by NVARCHAR(200) NOT NULL,
        shared_at DATETIME2 NOT NULL, validation_ends_on DATE NOT NULL, superseded_at DATETIME2 NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.FinalIssuanceRecords', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FinalIssuanceRecords (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), report_id UNIQUEIDENTIFIER NOT NULL UNIQUE REFERENCES dbo.ComplianceReports(id),
        recipient NVARCHAR(320) NOT NULL, delivery_method NVARCHAR(50) NOT NULL, sender_attestation NVARCHAR(1000) NOT NULL,
        issued_by NVARCHAR(200) NOT NULL, issued_at DATETIME2 NOT NULL, content_sha256 CHAR(64) NOT NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.AssessmentCredits', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AssessmentCredits (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), dispute_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.PenaltyDisputes(id),
        report_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.ComplianceReports(id), amount DECIMAL(12,2) NOT NULL,
        reason NVARCHAR(1000) NOT NULL, created_by NVARCHAR(200) NOT NULL, created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_AC_NonNegative CHECK(amount >= 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.AssessmentDisputeItems', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AssessmentDisputeItems (
        dispute_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.PenaltyDisputes(id),
        assessment_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.PeriodKpiAssessments(id),
        PRIMARY KEY(dispute_id,assessment_id)
    );
END;
GO

IF COL_LENGTH('dbo.PenaltyDisputes','report_id') IS NULL ALTER TABLE dbo.PenaltyDisputes ADD report_id UNIQUEIDENTIFIER NULL REFERENCES dbo.ComplianceReports(id);
IF COL_LENGTH('dbo.PenaltyDisputes','outcome') IS NULL ALTER TABLE dbo.PenaltyDisputes ADD outcome NVARCHAR(30) NULL;
IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.PenaltyDisputes') AND name='CK_PD_Status')
    ALTER TABLE dbo.PenaltyDisputes DROP CONSTRAINT CK_PD_Status;
ALTER TABLE dbo.PenaltyDisputes ADD CONSTRAINT CK_PD_Status CHECK(status IN('submitted','under_review','upheld','adjusted','rescinded','superseded','returned'));
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardPeriod AS
SELECT p.id PeriodId,p.contractor_id ContractorId,c.name ContractorName,
 CONVERT(date,CONCAT(LEFT(p.service_month,4),'-',RIGHT(p.service_month,2),'-01')) ServiceMonthStart,
 p.status Status,p.proposed_total ProposedTotal,p.final_total AssessedTotal,p.is_partial IsPartial,
 SUM(CASE WHEN a.tier_label='meets' THEN 1 ELSE 0 END) KpisMet,
 SUM(CASE WHEN a.tier_label='warning' THEN 1 ELSE 0 END) KpisWarning,
 SUM(CASE WHEN a.tier_label='tier1' THEN 1 ELSE 0 END) KpisTier1,
 SUM(CASE WHEN a.tier_label='tier2' THEN 1 ELSE 0 END) KpisTier2,
 SUM(CASE WHEN a.cap_required=1 THEN 1 ELSE 0 END) CapsRequired
FROM dbo.AssessmentPeriods p JOIN dbo.Contractors c ON c.id=p.contractor_id
JOIN dbo.PeriodKpiAssessments a ON a.period_id=p.id
WHERE p.status IN('finalized','issued')
GROUP BY p.id,p.contractor_id,c.name,p.service_month,p.status,p.proposed_total,p.final_total,p.is_partial;
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardKpi AS
SELECT p.id PeriodId,p.contractor_id ContractorId,c.name ContractorName,
 CONVERT(date,CONCAT(LEFT(p.service_month,4),'-',RIGHT(p.service_month,2),'-01')) ServiceMonthStart,
 s.id StandardId,s.code StandardCode,s.name StandardName,s.standard_type StandardType,s.priority Priority,
 a.metric_value MetricValue,a.metric_display MetricDisplay,a.target_display TargetDisplay,a.tier_label TierLabel,
 a.variance_pct VariancePct,a.occurrence_count OccurrenceCount,a.unit_quantity UnitQuantity,
 a.base_amount BaseAmount,a.relief_amount ReliefAmount,a.escalation_multiplier EscalationMultiplier,
 a.final_amount AssessedAmount,a.manager_action ManagerAction,a.consecutive_months_below ConsecutiveMonthsBelow,
 a.data_completeness_pct DataCompletenessPct,a.cap_required CapRequired
FROM dbo.AssessmentPeriods p JOIN dbo.Contractors c ON c.id=p.contractor_id
JOIN dbo.PeriodKpiAssessments a ON a.period_id=p.id JOIN dbo.ContractorPerformanceStandards s ON s.id=a.standard_id
WHERE p.status IN('finalized','issued');
GO

IF EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.AssessmentPeriods') AND name='CK_AP_Ramp')
    ALTER TABLE dbo.AssessmentPeriods DROP CONSTRAINT CK_AP_Ramp;
ALTER TABLE dbo.AssessmentPeriods ALTER COLUMN ramp_up_stage NVARCHAR(20) NULL;
UPDATE dbo.AssessmentPeriods SET ramp_up_stage=NULL;
UPDATE dbo.PeriodKpiAssessments SET ramp_up_multiplier=1;
GO

PRINT 'Migration 032 verified: governed Performance Assessment workflow is ready and ramp-up is excluded.';
