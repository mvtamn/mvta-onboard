-- A singleton health record is written only after a complete authoritative
-- reconciliation. Webhooks improve detail but do not establish source health.
CREATE TABLE dbo.OnDemandMonitoringHealth (
    id TINYINT NOT NULL PRIMARY KEY CONSTRAINT CK_OnDemandMonitoringHealth_Singleton CHECK (id = 1),
    last_authoritative_reconciliation_at DATETIME2 NOT NULL,
    latest_source_update_at DATETIME2 NULL,
    active_request_count INT NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_OnDemandMonitoringHealth_UpdatedAt DEFAULT SYSUTCDATETIME()
);
GO

PRINT 'Migration 082 applied: on-demand authoritative reconciliation health created.';
