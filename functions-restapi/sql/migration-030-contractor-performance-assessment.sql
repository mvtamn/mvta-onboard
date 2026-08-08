-- Migration 030: governed contractor performance assessment foundation.
--
-- Attachment G contains 18 occurrence-based standards and 8 threshold KPIs.
-- All 26 are catalogued here; only the nine High/Medium-priority standards in
-- ContractorPerformanceStandards_v3.xlsx are scored in v1. Assessment output
-- is revisioned and hashed so a manager cannot finalize stale calculations.

IF OBJECT_ID(N'dbo.Contractors', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Contractors (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        name NVARCHAR(200) NOT NULL,
        contract_start_date CHAR(8) NOT NULL,
        contract_end_date CHAR(8) NULL,
        is_active BIT NOT NULL DEFAULT 1,
        updated_by NVARCHAR(200) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_Contractors_StartDate CHECK (contract_start_date NOT LIKE '%[^0-9]%'),
        CONSTRAINT CK_Contractors_EndDate CHECK (contract_end_date IS NULL OR contract_end_date NOT LIKE '%[^0-9]%')
    );
END;
GO

IF OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ContractorPerformanceStandards (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        code NVARCHAR(50) NOT NULL UNIQUE,
        name NVARCHAR(200) NOT NULL,
        description NVARCHAR(2000) NULL,
        standard_type NVARCHAR(20) NOT NULL,
        priority NVARCHAR(10) NOT NULL,
        is_scored BIT NOT NULL DEFAULT 0,
        is_safety_critical BIT NOT NULL DEFAULT 0,
        direction NVARCHAR(30) NOT NULL,
        unit_label NVARCHAR(50) NOT NULL,
        measurement_source NVARCHAR(20) NOT NULL,
        resolver_key NVARCHAR(50) NULL,
        data_source_note NVARCHAR(1000) NULL,
        responsible_team NVARCHAR(200) NULL,
        assigned_to NVARCHAR(200) NULL,
        cap_rule_note NVARCHAR(1000) NULL,
        sort_order INT NOT NULL,
        effective_start_date CHAR(8) NOT NULL DEFAULT '20250101',
        effective_end_date CHAR(8) NULL,
        updated_by NVARCHAR(200) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_CPS_Type CHECK (standard_type IN ('occurrence', 'threshold')),
        CONSTRAINT CK_CPS_Priority CHECK (priority IN ('High', 'Medium', 'Low', 'NA')),
        CONSTRAINT CK_CPS_Direction CHECK (direction IN ('higher_is_better', 'lower_is_better')),
        CONSTRAINT CK_CPS_Source CHECK (measurement_source IN ('auto', 'manual'))
    );
END;
GO

IF OBJECT_ID(N'dbo.ContractorStandardTiers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ContractorStandardTiers (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        standard_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.ContractorPerformanceStandards(id),
        tier_order INT NOT NULL,
        tier_label NVARCHAR(20) NOT NULL,
        bound_low FLOAT NULL,
        bound_high FLOAT NULL,
        qualifier_code NVARCHAR(50) NULL,
        penalty_basis NVARCHAR(30) NOT NULL,
        penalty_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        triggers_cap BIT NOT NULL DEFAULT 0,
        notes NVARCHAR(1000) NULL,
        effective_start_date CHAR(8) NOT NULL DEFAULT '20250101',
        effective_end_date CHAR(8) NULL,
        updated_by NVARCHAR(200) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_CST_Label CHECK (tier_label IN ('meets', 'warning', 'tier1', 'tier2')),
        CONSTRAINT CK_CST_Basis CHECK (penalty_basis IN ('none', 'flat', 'per_unit', 'per_unit_per_day', 'per_day', 'per_week')),
        CONSTRAINT CK_CST_Bounds CHECK (bound_low IS NULL OR bound_high IS NULL OR bound_low < bound_high),
        CONSTRAINT UQ_CST_Version UNIQUE (standard_id, tier_order, effective_start_date)
    );
END;
GO

IF OBJECT_ID(N'dbo.ExcusableDelayClaims', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ExcusableDelayClaims (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        contractor_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Contractors(id),
        service_month CHAR(6) NOT NULL,
        event_description NVARCHAR(2000) NOT NULL,
        event_started_at DATETIME2 NOT NULL,
        notice_received_at DATETIME2 NOT NULL,
        documentation_note NVARCHAR(2000) NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'submitted',
        decided_by NVARCHAR(200) NULL,
        decided_at DATETIME2 NULL,
        decision_note NVARCHAR(1000) NULL,
        created_by NVARCHAR(200) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_EDC_Status CHECK (status IN ('submitted', 'approved', 'denied'))
    );
END;
GO

IF OBJECT_ID(N'dbo.ComplianceOccurrences', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ComplianceOccurrences (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        standard_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.ContractorPerformanceStandards(id),
        contractor_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Contractors(id),
        service_date CHAR(8) NOT NULL,
        service_month AS LEFT(service_date, 6) PERSISTED,
        quantity INT NOT NULL DEFAULT 1,
        duration_days INT NULL,
        qualifier_code NVARCHAR(50) NULL,
        description NVARCHAR(2000) NOT NULL,
        source NVARCHAR(30) NOT NULL,
        source_ref NVARCHAR(300) NULL,
        review_status NVARCHAR(20) NOT NULL DEFAULT 'candidate',
        attribution NVARCHAR(30) NOT NULL DEFAULT 'undetermined',
        dismiss_reason NVARCHAR(1000) NULL,
        relief_id UNIQUEIDENTIFIER NULL REFERENCES dbo.ExcusableDelayClaims(id),
        reviewed_by NVARCHAR(200) NULL,
        reviewed_at DATETIME2 NULL,
        created_by NVARCHAR(200) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_CO_ServiceDate CHECK (LEN(service_date) = 8 AND service_date NOT LIKE '%[^0-9]%'),
        CONSTRAINT CK_CO_Quantity CHECK (quantity > 0),
        CONSTRAINT CK_CO_Duration CHECK (duration_days IS NULL OR duration_days > 0),
        CONSTRAINT CK_CO_Source CHECK (source IN ('auto_candidate', 'manual')),
        CONSTRAINT CK_CO_Review CHECK (review_status IN ('candidate', 'confirmed', 'dismissed')),
        CONSTRAINT CK_CO_Attribution CHECK (attribution IN ('contractor_error', 'excusable', 'mvta_directed', 'undetermined'))
    );
    CREATE UNIQUE INDEX UX_CO_SourceRef ON dbo.ComplianceOccurrences(source_ref) WHERE source_ref IS NOT NULL;
    CREATE INDEX IX_CO_PeriodStandardReview ON dbo.ComplianceOccurrences(service_month, standard_id, review_status);
END;
GO

IF OBJECT_ID(N'dbo.ManualMetricEntries', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ManualMetricEntries (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        standard_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.ContractorPerformanceStandards(id),
        contractor_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Contractors(id),
        service_month CHAR(6) NOT NULL,
        metric_value FLOAT NOT NULL,
        numerator FLOAT NULL,
        denominator FLOAT NULL,
        unit_count INT NULL,
        source_note NVARCHAR(1000) NOT NULL,
        entered_by NVARCHAR(200) NOT NULL,
        entered_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        superseded_by UNIQUEIDENTIFIER NULL REFERENCES dbo.ManualMetricEntries(id),
        CONSTRAINT CK_MME_Month CHECK (LEN(service_month) = 6 AND service_month NOT LIKE '%[^0-9]%'),
        CONSTRAINT CK_MME_Units CHECK (unit_count IS NULL OR unit_count >= 0)
    );
    CREATE UNIQUE INDEX UX_MME_Current ON dbo.ManualMetricEntries(standard_id, contractor_id, service_month) WHERE superseded_by IS NULL;
END;
GO

IF OBJECT_ID(N'dbo.SystemOutageWindows', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SystemOutageWindows (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        system NVARCHAR(50) NOT NULL,
        started_at DATETIME2 NOT NULL,
        ended_at DATETIME2 NULL,
        scope_note NVARCHAR(1000) NOT NULL,
        logged_by NVARCHAR(200) NOT NULL,
        logged_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_SOW_System CHECK (system IN ('Avail_CAD_AVL', 'ITMS', 'MDT', 'Spare', 'Other')),
        CONSTRAINT CK_SOW_Window CHECK (ended_at IS NULL OR ended_at > started_at)
    );
END;
GO

IF OBJECT_ID(N'dbo.AssessmentPeriods', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AssessmentPeriods (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        contractor_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Contractors(id),
        service_month CHAR(6) NOT NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'open',
        ramp_up_stage NVARCHAR(20) NOT NULL,
        input_revision INT NOT NULL DEFAULT 0,
        computed_revision INT NULL,
        computed_at DATETIME2 NULL,
        proposed_total DECIMAL(12,2) NOT NULL DEFAULT 0,
        final_total DECIMAL(12,2) NULL,
        finalized_by NVARCHAR(200) NULL,
        finalized_at DATETIME2 NULL,
        notes NVARCHAR(2000) NULL,
        CONSTRAINT UQ_AP_ContractorMonth UNIQUE (contractor_id, service_month),
        CONSTRAINT CK_AP_Status CHECK (status IN ('open', 'in_review', 'stale', 'finalized', 'reopened')),
        CONSTRAINT CK_AP_Ramp CHECK (ramp_up_stage IN ('suspended', 'half', 'full')),
        CONSTRAINT CK_AP_Revisions CHECK (input_revision >= 0 AND (computed_revision IS NULL OR computed_revision <= input_revision))
    );
END;
GO

IF OBJECT_ID(N'dbo.PeriodKpiAssessments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PeriodKpiAssessments (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        period_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.AssessmentPeriods(id),
        standard_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.ContractorPerformanceStandards(id),
        metric_value FLOAT NULL,
        metric_display NVARCHAR(50) NOT NULL,
        occurrence_count INT NOT NULL DEFAULT 0,
        unit_quantity FLOAT NOT NULL DEFAULT 0,
        tier_label NVARCHAR(20) NOT NULL,
        target_display NVARCHAR(100) NOT NULL,
        variance_pct FLOAT NULL,
        base_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        ramp_up_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1,
        escalation_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1,
        relief_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        proposed_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        input_sha256 CHAR(64) NOT NULL,
        final_amount DECIMAL(12,2) NULL,
        manager_action NVARCHAR(20) NOT NULL DEFAULT 'pending',
        manager_reason NVARCHAR(1000) NULL,
        reviewed_input_sha256 CHAR(64) NULL,
        cap_required BIT NOT NULL DEFAULT 0,
        cap_reason NVARCHAR(500) NULL,
        consecutive_months_below INT NOT NULL DEFAULT 0,
        data_completeness_pct FLOAT NULL,
        computation_json NVARCHAR(MAX) NOT NULL,
        reviewed_by NVARCHAR(200) NULL,
        reviewed_at DATETIME2 NULL,
        CONSTRAINT UQ_PKA_PeriodStandard UNIQUE (period_id, standard_id),
        CONSTRAINT CK_PKA_Tier CHECK (tier_label IN ('meets', 'warning', 'tier1', 'tier2')),
        CONSTRAINT CK_PKA_Action CHECK (manager_action IN ('pending', 'confirmed', 'adjusted', 'waived')),
        CONSTRAINT CK_PKA_Reason CHECK (manager_action NOT IN ('adjusted', 'waived') OR LEN(LTRIM(RTRIM(manager_reason))) > 0),
        CONSTRAINT CK_PKA_ReviewedHash CHECK (manager_action = 'pending' OR reviewed_input_sha256 = input_sha256)
    );
END;
GO

IF OBJECT_ID(N'dbo.ComplianceEvidence', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ComplianceEvidence (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        occurrence_id UNIQUEIDENTIFIER NULL REFERENCES dbo.ComplianceOccurrences(id),
        metric_entry_id UNIQUEIDENTIFIER NULL REFERENCES dbo.ManualMetricEntries(id),
        blob_path NVARCHAR(1000) NOT NULL,
        content_type NVARCHAR(200) NOT NULL,
        file_size_bytes BIGINT NOT NULL,
        caption NVARCHAR(500) NULL,
        uploaded_by NVARCHAR(200) NOT NULL,
        uploaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_CE_OneParent CHECK ((CASE WHEN occurrence_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN metric_entry_id IS NULL THEN 0 ELSE 1 END) = 1),
        CONSTRAINT CK_CE_Size CHECK (file_size_bytes > 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.MvtaHolidays', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MvtaHolidays (
        holiday_date DATE NOT NULL PRIMARY KEY,
        description NVARCHAR(200) NOT NULL,
        updated_by NVARCHAR(200) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.MvtaHolidayCalendarCoverage', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MvtaHolidayCalendarCoverage (
        id TINYINT NOT NULL PRIMARY KEY,
        coverage_through DATE NOT NULL,
        updated_by NVARCHAR(200) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_MHCC_SingleRow CHECK (id = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.ComplianceAssessmentAudit', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ComplianceAssessmentAudit (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        entity_type NVARCHAR(50) NOT NULL,
        entity_id UNIQUEIDENTIFIER NOT NULL,
        action NVARCHAR(100) NOT NULL,
        actor NVARCHAR(200) NOT NULL,
        before_json NVARCHAR(MAX) NULL,
        after_json NVARCHAR(MAX) NULL,
        note NVARCHAR(1000) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_CAA_Entity ON dbo.ComplianceAssessmentAudit(entity_type, entity_id);
    CREATE INDEX IX_CAA_Created ON dbo.ComplianceAssessmentAudit(created_at);
END;
GO

IF OBJECT_ID(N'dbo.CorrectiveActionPlans', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CorrectiveActionPlans (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), contractor_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Contractors(id),
        standard_id UNIQUEIDENTIFIER NULL REFERENCES dbo.ContractorPerformanceStandards(id), period_id UNIQUEIDENTIFIER NULL REFERENCES dbo.AssessmentPeriods(id),
        trigger_reason NVARCHAR(40) NOT NULL,status NVARCHAR(20) NOT NULL DEFAULT 'required',requested_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),due_at DATETIME2 NOT NULL,
        submitted_at DATETIME2 NULL,root_cause NVARCHAR(MAX) NULL,corrective_actions NVARCHAR(MAX) NULL,responsible_parties NVARCHAR(MAX) NULL,
        timeline_note NVARCHAR(MAX) NULL,monitoring_plan NVARCHAR(MAX) NULL,closure_criteria NVARCHAR(MAX) NULL,closed_at DATETIME2 NULL,closure_note NVARCHAR(MAX) NULL,
        created_by NVARCHAR(200) NOT NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_CAP_Trigger CHECK(trigger_reason IN('three_consecutive_months','deviation_over_10pct','tier_rule','rolling_window_rule','discretionary','contractor_initiated')),
        CONSTRAINT CK_CAP_Status CHECK(status IN('required','submitted','approved','in_progress','closed','failed'))
    );
END;
GO

IF OBJECT_ID(N'dbo.PenaltyDisputes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PenaltyDisputes (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),assessment_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.PeriodKpiAssessments(id),
        contractor_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Contractors(id),submitted_at DATETIME2 NOT NULL,notice_deadline_at DATETIME2 NOT NULL,
        basis NVARCHAR(MAX) NOT NULL,references_outage_id UNIQUEIDENTIFIER NULL REFERENCES dbo.SystemOutageWindows(id),references_claim_id UNIQUEIDENTIFIER NULL REFERENCES dbo.ExcusableDelayClaims(id),
        completeness NVARCHAR(30) NOT NULL,status NVARCHAR(30) NOT NULL,determination_due_at DATETIME2 NULL,determination_note NVARCHAR(MAX) NULL,
        adjusted_amount DECIMAL(12,2) NULL,decided_by NVARCHAR(200) NULL,decided_at DATETIME2 NULL,created_by NVARCHAR(200) NOT NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_PD_Completeness CHECK(completeness IN('complete','returned_incomplete')),
        CONSTRAINT CK_PD_Status CHECK(status IN('submitted','under_review','upheld','reduced','waived','returned'))
    );
END;
GO

IF OBJECT_ID(N'dbo.ComplianceReports', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ComplianceReports (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),period_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.AssessmentPeriods(id),
        contractor_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Contractors(id),service_month CHAR(6) NOT NULL,issuance_type NVARCHAR(20) NOT NULL,
        version INT NOT NULL,supersedes_id UNIQUEIDENTIFIER NULL REFERENCES dbo.ComplianceReports(id),blob_path NVARCHAR(1000) NOT NULL,
        content_type NVARCHAR(100) NOT NULL DEFAULT 'text/html; charset=utf-8',content_sha256 CHAR(64) NOT NULL,assessed_total DECIMAL(12,2) NOT NULL,
        issued_at DATETIME2 NULL,issued_by NVARCHAR(200) NULL,dispute_deadline_at DATETIME2 NULL,supersede_reason NVARCHAR(500) NULL,
        generated_by NVARCHAR(200) NOT NULL,generated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_CR_Type CHECK(issuance_type IN('preliminary','final')),CONSTRAINT UQ_CR_Version UNIQUE(period_id,issuance_type,version),
        CONSTRAINT CK_CR_SupersedeReason CHECK(supersedes_id IS NULL OR LEN(LTRIM(RTRIM(supersede_reason)))>0)
    );
END;
GO

-- Seed the complete Attachment G catalog. MERGE updates descriptive working-copy
-- metadata without changing stable IDs referenced by assessment history.
MERGE dbo.ContractorPerformanceStandards AS target
USING (VALUES
 (N'MISSED_TRIPS_FR',N'Missed Trips Fixed Route / Microtransit',N'occurrence',N'High',1,0,N'lower_is_better',N'occurrences',N'auto',N'MISSED_TRIPS_FR',N'Operations Control',N'Rob',1),
 (N'GARAGE_DEPARTURE',N'Garage Departure Compliance',N'occurrence',N'Medium',1,0,N'lower_is_better',N'occurrences',N'auto',N'GARAGE_DEPARTURE',N'Transit Operations',N'Corrina/Maurice',2),
 (N'UNATTENDED_RIDER',N'Unattended Rider at Garage',N'occurrence',N'Low',0,1,N'lower_is_better',N'occurrences',N'manual',NULL,N'Transit Operations',N'Rob/Jason',3),
 (N'ITMS_LOGIN_FAILURE',N'ITMS Software Log-in/out Failures',N'occurrence',N'Low',0,0,N'lower_is_better',N'occurrences',N'manual',NULL,N'Operations Control',N'Corrina',4),
 (N'ADA_TITLE_VI',N'ADA & Title VI Non-Compliance',N'occurrence',N'Medium',1,1,N'lower_is_better',N'occurrences',N'manual',NULL,N'Safety / Customer Service',N'Rob/Cody/Jason',5),
 (N'UNIFORM_COMPLIANCE',N'Uniform Compliance / ID Display',N'occurrence',N'Low',0,0,N'lower_is_better',N'occurrences',N'manual',NULL,N'Transit Operations',N'Rob',6),
 (N'ROAD_SUPERVISOR',N'Road Supervisor Field Presence / Equipment',N'occurrence',N'Low',0,0,N'lower_is_better',N'occurrences',N'manual',NULL,N'Transit Operations',N'Rob',7),
 (N'OPERATOR_STAFFING',N'Operator Staffing & Qualifications',N'occurrence',N'NA',0,1,N'lower_is_better',N'occurrences',N'manual',NULL,N'Transit Operations / HR',N'Rob/Cody/Jason',8),
 (N'INITIAL_TRAINING',N'Initial Operator Training Violations',N'occurrence',N'Low',0,1,N'lower_is_better',N'occurrences',N'manual',NULL,N'Safety / Training',N'Rob/Cody',9),
 (N'CORRECTIVE_RETRAINING',N'Corrective Retraining Failures',N'occurrence',N'Low',0,1,N'lower_is_better',N'occurrences',N'manual',NULL,N'Safety',N'Rob/Cody',10),
 (N'TRAINING_RECORDS',N'Training Records Missing/Inaccurate',N'occurrence',N'Low',0,0,N'lower_is_better',N'occurrences',N'manual',NULL,NULL,N'Rob/Cody',11),
 (N'ROSTER_SUBMISSION',N'Roster Submission Non-Compliance',N'occurrence',N'Low',0,0,N'lower_is_better',N'occurrences',N'manual',NULL,NULL,N'Rob/Cody',12),
 (N'PRE_POST_TRIP',N'Pre/Post Trip Inspection Failures',N'occurrence',N'Low',0,1,N'lower_is_better',N'occurrences',N'manual',NULL,NULL,N'Rob',13),
 (N'SHUTDOWN_VEHICLE',N'Shutdown Vehicle',N'occurrence',N'High',1,0,N'lower_is_better',N'vehicle-days',N'manual',NULL,NULL,N'Maurice/Alex/Rob',14),
 (N'MECHANIC_STAFFING',N'Mechanic Staffing Gaps',N'occurrence',N'Low',0,0,N'lower_is_better',N'weeks',N'manual',NULL,N'Fleet',N'Rob/Michael/Alex',15),
 (N'MECHANIC_TRAINING',N'Mechanic Training Incomplete',N'occurrence',N'Low',0,0,N'lower_is_better',N'days',N'manual',NULL,NULL,N'Rob/Michael/Alex',16),
 (N'INCIDENT_REPORTING',N'Incident and Data Reporting',N'occurrence',N'Medium',1,0,N'lower_is_better',N'occurrences',N'manual',NULL,NULL,N'Rob',17),
 (N'PREVENTABLE_COLLISIONS',N'Preventable Collisions',N'occurrence',N'High',1,1,N'lower_is_better',N'occurrences',N'manual',NULL,NULL,N'Rob/Cody',18),
 (N'SAFETY_MEETING',N'Safety Meeting Attendance Compliance',N'threshold',N'Low',0,0,N'higher_is_better',N'percent',N'manual',NULL,N'Safety',N'Maurice',19),
 (N'BUS_CLEANING',N'Bus Cleaning Compliance',N'threshold',N'NA',0,0,N'higher_is_better',N'percent',N'manual',NULL,NULL,NULL,20),
 (N'BUS_DEEP_CLEANING',N'Bus Deep Cleaning Rate',N'threshold',N'NA',0,0,N'lower_is_better',N'occurrences',N'manual',NULL,NULL,NULL,21),
 (N'FLEET_AVAIL_SHORT',N'Fleet Availability Short-Term',N'threshold',N'NA',0,0,N'higher_is_better',N'percent',N'manual',NULL,NULL,NULL,22),
 (N'FLEET_AVAIL_LONG',N'Fleet Availability Long-Term',N'threshold',N'NA',0,0,N'lower_is_better',N'vehicles',N'manual',NULL,NULL,NULL,23),
 (N'AVG_MILES_ROAD_CALLS',N'Average Miles Between Road Calls (Preventative Maintenance)',N'threshold',N'Medium',1,0,N'higher_is_better',N'miles',N'manual',NULL,NULL,N'Maurice',24),
 (N'OPERATOR_CONDUCT',N'Operator Conduct Complaints',N'threshold',N'High',1,0,N'lower_is_better',N'occurrences',N'manual',NULL,N'Transit Operations',N'Rob',25),
 (N'OTP_FIXED_ROUTE',N'On-Time Performance (Fixed Route)',N'threshold',N'High',1,0,N'higher_is_better',N'percent',N'auto',N'OTP_FIXED_ROUTE',N'Operations Control',N'Rob/Corrina',26)
) AS source(code,name,standard_type,priority,is_scored,is_safety_critical,direction,unit_label,measurement_source,resolver_key,responsible_team,assigned_to,sort_order)
ON target.code = source.code
WHEN MATCHED THEN UPDATE SET name=source.name, standard_type=source.standard_type, priority=source.priority,
 is_scored=source.is_scored, is_safety_critical=source.is_safety_critical, direction=source.direction,
 unit_label=source.unit_label, measurement_source=source.measurement_source, resolver_key=source.resolver_key,
 responsible_team=source.responsible_team, assigned_to=source.assigned_to, sort_order=source.sort_order,
 updated_by=N'migration-030', updated_at=SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT(code,name,standard_type,priority,is_scored,is_safety_critical,direction,unit_label,measurement_source,resolver_key,responsible_team,assigned_to,sort_order,updated_by)
 VALUES(source.code,source.name,source.standard_type,source.priority,source.is_scored,source.is_safety_critical,source.direction,source.unit_label,source.measurement_source,source.resolver_key,source.responsible_team,source.assigned_to,source.sort_order,N'migration-030');
GO

-- The nine scored standards' governing tiers. Percentages are stored as ratios.
DELETE tier
FROM dbo.ContractorStandardTiers tier
JOIN dbo.ContractorPerformanceStandards standard ON standard.id = tier.standard_id
WHERE standard.is_scored = 1 AND tier.updated_by = N'migration-030';
GO

INSERT dbo.ContractorStandardTiers
 (standard_id,tier_order,tier_label,bound_low,bound_high,qualifier_code,penalty_basis,penalty_amount,triggers_cap,notes,updated_by)
SELECT standard.id, tier.tier_order, tier.tier_label, tier.bound_low, tier.bound_high, tier.qualifier_code,
 tier.penalty_basis, tier.penalty_amount, tier.triggers_cap, tier.notes, N'migration-030'
FROM dbo.ContractorPerformanceStandards standard
JOIN (VALUES
 (N'MISSED_TRIPS_FR',1,N'tier1',NULL,NULL,NULL,N'per_unit',1000,0,N'Default missed trip'),
 (N'MISSED_TRIPS_FR',2,N'tier2',NULL,NULL,N'LAST_TRIP_OF_DAY',N'per_unit',2000,0,N'Last scheduled trip of service day'),
 (N'GARAGE_DEPARTURE',1,N'tier1',NULL,NULL,NULL,N'per_unit',500,0,NULL),
 (N'ADA_TITLE_VI',1,N'tier1',NULL,NULL,NULL,N'per_unit',1000,0,NULL),
 (N'SHUTDOWN_VEHICLE',1,N'tier1',NULL,NULL,NULL,N'per_unit_per_day',1000,0,NULL),
 (N'INCIDENT_REPORTING',1,N'tier1',NULL,NULL,NULL,N'per_unit',500,0,NULL),
 (N'PREVENTABLE_COLLISIONS',1,N'tier1',NULL,NULL,NULL,N'per_unit',500,0,N'Reported within required timeframe'),
 (N'PREVENTABLE_COLLISIONS',2,N'tier2',NULL,NULL,N'REPORTING_LATE',N'per_unit',1000,0,N'Not reported within required timeframe'),
 (N'AVG_MILES_ROAD_CALLS',1,N'meets',12000,NULL,NULL,N'none',0,0,NULL),
 (N'AVG_MILES_ROAD_CALLS',2,N'warning',11000,12000,NULL,N'none',0,1,N'CAP warning'),
 (N'AVG_MILES_ROAD_CALLS',3,N'tier1',10000,11000,NULL,N'flat',2000,0,NULL),
 (N'AVG_MILES_ROAD_CALLS',4,N'tier2',NULL,10000,NULL,N'flat',3500,0,NULL),
 (N'OPERATOR_CONDUCT',1,N'meets',NULL,11,NULL,N'none',0,0,NULL),
 (N'OPERATOR_CONDUCT',2,N'warning',11,13,NULL,N'none',0,0,NULL),
 (N'OPERATOR_CONDUCT',3,N'tier1',13,16,NULL,N'per_unit',250,0,NULL),
 (N'OPERATOR_CONDUCT',4,N'tier2',16,NULL,NULL,N'per_unit',250,1,N'CAP required'),
 (N'OTP_FIXED_ROUTE',1,N'meets',0.85,NULL,NULL,N'none',0,0,NULL),
 (N'OTP_FIXED_ROUTE',2,N'warning',0.80,0.85,NULL,N'none',0,0,NULL),
 (N'OTP_FIXED_ROUTE',3,N'tier1',0.75,0.80,NULL,N'flat',1500,0,NULL),
 (N'OTP_FIXED_ROUTE',4,N'tier2',NULL,0.75,NULL,N'flat',3500,0,NULL)
) tier(code,tier_order,tier_label,bound_low,bound_high,qualifier_code,penalty_basis,penalty_amount,triggers_cap,notes)
 ON standard.code = tier.code;
GO

PRINT 'Migration 030 verified: contractor assessment foundation and 26-standard catalog are present.';
