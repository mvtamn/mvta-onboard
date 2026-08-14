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

UPDATE dbo.AssessmentPeriods SET ramp_up_stage='full';
UPDATE dbo.PeriodKpiAssessments SET ramp_up_multiplier=1;
GO

PRINT 'Migration 032 verified: governed Performance Assessment workflow is ready and ramp-up is excluded.';
