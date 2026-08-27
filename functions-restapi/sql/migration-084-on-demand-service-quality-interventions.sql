-- Durable, reviewable evidence for on-demand wait risks. A recovered source
-- record resolves the intervention automatically; staff may also resolve it.
CREATE TABLE dbo.OnDemandServiceQualityInterventions (
    request_id NVARCHAR(100) NOT NULL PRIMARY KEY,
    status NVARCHAR(20) NOT NULL CONSTRAINT CK_OnDemandServiceQualityInterventions_Status CHECK (status IN ('open', 'resolved')),
    projected_breach_count INT NOT NULL CONSTRAINT DF_OnDemandServiceQualityInterventions_ProjectedCount DEFAULT 0,
    suggested_alert_id UNIQUEIDENTIFIER NULL,
    opened_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    last_authoritative_at DATETIME2 NOT NULL,
    resolved_at DATETIME2 NULL,
    resolved_by NVARCHAR(200) NULL,
    resolution_reason NVARCHAR(500) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE INDEX IX_OnDemandServiceQualityInterventions_Open
    ON dbo.OnDemandServiceQualityInterventions (status, last_authoritative_at DESC);
GO

PRINT 'Migration 083 applied: on-demand service-quality interventions created.';
