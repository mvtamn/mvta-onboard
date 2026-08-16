IF OBJECT_ID('dbo.EventServicePlanConflictOverrides', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EventServicePlanConflictOverrides (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.EventServicePlans(id),
    conflict_type NVARCHAR(40) NOT NULL,
    conflict_key NVARCHAR(200) NOT NULL,
    reason NVARCHAR(1000) NOT NULL,
    created_by NVARCHAR(200) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_EventServicePlanConflictOverrides_Plan ON dbo.EventServicePlanConflictOverrides(service_plan_id, created_at DESC);
END;
GO
PRINT 'Migration 063 applied: reasoned Event Plan conflict overrides are auditable.';
