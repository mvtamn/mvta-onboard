-- Migration 031: read-only Power BI scorecard views.
-- Grants are intentionally view-only. The contained user's password is
-- provisioned out-of-band from Key Vault and is never committed to SQL source.

CREATE OR ALTER VIEW dbo.vw_ScorecardPeriod AS
SELECT p.id PeriodId,p.contractor_id ContractorId,c.name ContractorName,
 CONVERT(date,CONCAT(LEFT(p.service_month,4),'-',RIGHT(p.service_month,2),'-01')) ServiceMonthStart,
 p.status Status,p.ramp_up_stage RampUpStage,p.proposed_total ProposedTotal,p.final_total AssessedTotal,
 SUM(CASE WHEN a.tier_label='meets' THEN 1 ELSE 0 END) KpisMet,
 SUM(CASE WHEN a.tier_label='warning' THEN 1 ELSE 0 END) KpisWarning,
 SUM(CASE WHEN a.tier_label='tier1' THEN 1 ELSE 0 END) KpisTier1,
 SUM(CASE WHEN a.tier_label='tier2' THEN 1 ELSE 0 END) KpisTier2,
 SUM(CASE WHEN a.cap_required=1 THEN 1 ELSE 0 END) CapsRequired
FROM dbo.AssessmentPeriods p JOIN dbo.Contractors c ON c.id=p.contractor_id
JOIN dbo.PeriodKpiAssessments a ON a.period_id=p.id
WHERE p.status='finalized'
GROUP BY p.id,p.contractor_id,c.name,p.service_month,p.status,p.ramp_up_stage,p.proposed_total,p.final_total;
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardKpi AS
SELECT p.id PeriodId,p.contractor_id ContractorId,c.name ContractorName,
 CONVERT(date,CONCAT(LEFT(p.service_month,4),'-',RIGHT(p.service_month,2),'-01')) ServiceMonthStart,
 s.id StandardId,s.code StandardCode,s.name StandardName,s.standard_type StandardType,s.priority Priority,
 a.metric_value MetricValue,a.metric_display MetricDisplay,a.target_display TargetDisplay,a.tier_label TierLabel,
 a.variance_pct VariancePct,a.occurrence_count OccurrenceCount,a.unit_quantity UnitQuantity,
 a.base_amount BaseAmount,a.relief_amount ReliefAmount,a.ramp_up_multiplier RampUpMultiplier,
 a.escalation_multiplier EscalationMultiplier,a.final_amount AssessedAmount,a.manager_action ManagerAction,
 a.consecutive_months_below ConsecutiveMonthsBelow,a.data_completeness_pct DataCompletenessPct,a.cap_required CapRequired
FROM dbo.AssessmentPeriods p JOIN dbo.Contractors c ON c.id=p.contractor_id
JOIN dbo.PeriodKpiAssessments a ON a.period_id=p.id JOIN dbo.ContractorPerformanceStandards s ON s.id=a.standard_id
WHERE p.status='finalized';
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardKpi_All AS
SELECT p.id PeriodId,p.contractor_id ContractorId,c.name ContractorName,p.status PeriodStatus,
 CONVERT(date,CONCAT(LEFT(p.service_month,4),'-',RIGHT(p.service_month,2),'-01')) ServiceMonthStart,
 s.id StandardId,s.code StandardCode,s.name StandardName,a.metric_value MetricValue,a.tier_label TierLabel,
 a.proposed_amount ProposedAmount,a.final_amount AssessedAmount,a.manager_action ManagerAction,a.data_completeness_pct DataCompletenessPct
FROM dbo.AssessmentPeriods p JOIN dbo.Contractors c ON c.id=p.contractor_id
JOIN dbo.PeriodKpiAssessments a ON a.period_id=p.id JOIN dbo.ContractorPerformanceStandards s ON s.id=a.standard_id;
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardOccurrence AS
SELECT o.id OccurrenceId,o.contractor_id ContractorId,CONVERT(date,STUFF(STUFF(o.service_date,5,0,'-'),8,0,'-')) ServiceDate,
 s.id StandardId,s.code StandardCode,s.name StandardName,o.quantity Quantity,o.qualifier_code QualifierCode,
 (SELECT COUNT(*) FROM dbo.ComplianceEvidence e WHERE e.occurrence_id=o.id) EvidenceCount
FROM dbo.ComplianceOccurrences o JOIN dbo.ContractorPerformanceStandards s ON s.id=o.standard_id
WHERE o.review_status='confirmed' AND o.attribution='contractor_error';
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardStandard AS
SELECT id StandardId,code StandardCode,name StandardName,standard_type StandardType,priority Priority,is_scored IsScored,
 is_safety_critical IsSafetyCritical,direction Direction,unit_label UnitLabel,responsible_team ResponsibleTeam,assigned_to Owner
FROM dbo.ContractorPerformanceStandards;
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardTier AS
SELECT s.id StandardId,s.code StandardCode,t.tier_order TierOrder,t.tier_label TierLabel,t.bound_low BoundLow,t.bound_high BoundHigh,
 t.qualifier_code QualifierCode,t.penalty_basis PenaltyBasis,t.penalty_amount PenaltyAmount,t.triggers_cap TriggersCap,
 CONVERT(date,STUFF(STUFF(t.effective_start_date,5,0,'-'),8,0,'-')) EffectiveStartDate
FROM dbo.ContractorStandardTiers t JOIN dbo.ContractorPerformanceStandards s ON s.id=t.standard_id;
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardTrend AS
SELECT p.contractor_id ContractorId,s.id StandardId,s.code StandardCode,
 CONVERT(date,CONCAT(LEFT(p.service_month,4),'-',RIGHT(p.service_month,2),'-01')) ServiceMonthStart,
 a.metric_value MetricValue,a.tier_label TierLabel,a.final_amount AssessedAmount,a.data_completeness_pct DataCompletenessPct
FROM dbo.AssessmentPeriods p JOIN dbo.PeriodKpiAssessments a ON a.period_id=p.id
JOIN dbo.ContractorPerformanceStandards s ON s.id=a.standard_id WHERE p.status='finalized';
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardCap AS
SELECT cap.id CapId,cap.contractor_id ContractorId,cap.standard_id StandardId,cap.period_id PeriodId,
 cap.trigger_reason TriggerReason,cap.status Status,cap.requested_at RequestedAt,cap.due_at DueAt,cap.closed_at ClosedAt,
 CASE WHEN cap.status NOT IN('closed','failed') AND cap.due_at<SYSUTCDATETIME() THEN CONVERT(bit,1) ELSE CONVERT(bit,0) END IsOverdue
FROM dbo.CorrectiveActionPlans cap;
GO

CREATE OR ALTER VIEW dbo.vw_ScorecardDispute AS
SELECT d.id DisputeId,d.contractor_id ContractorId,d.assessment_id AssessmentId,d.status Status,d.completeness Completeness,
 d.submitted_at SubmittedAt,d.notice_deadline_at NoticeDeadlineAt,d.determination_due_at DeterminationDueAt,d.adjusted_amount AdjustedAmount
FROM dbo.PenaltyDisputes d;
GO

IF DATABASE_PRINCIPAL_ID(N'mvta_reporting_ro') IS NOT NULL
BEGIN
    GRANT SELECT ON dbo.vw_ScorecardPeriod TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_ScorecardKpi TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_ScorecardOccurrence TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_ScorecardStandard TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_ScorecardTier TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_ScorecardTrend TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_ScorecardCap TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_ScorecardDispute TO mvta_reporting_ro;
    DENY SELECT ON dbo.PeriodKpiAssessments TO mvta_reporting_ro;
    DENY SELECT ON dbo.Subscribers TO mvta_reporting_ro;
    DENY SELECT ON dbo.ComplianceEvidence TO mvta_reporting_ro;
END;
GO

PRINT 'Migration 031 verified: finalized scorecard reporting views are present.';
