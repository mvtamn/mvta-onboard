-- Operational health, bounded telemetry diagnostics, and retention state for
-- Event Monitoring. Raw event positions are retained for 90 days.
CREATE TABLE EventModuleHealth (
    component NVARCHAR(50) NOT NULL PRIMARY KEY,
    status NVARCHAR(20) NOT NULL,
    last_attempt_at DATETIME2 NULL,
    last_success_at DATETIME2 NULL,
    last_error NVARCHAR(500) NULL,
    detail NVARCHAR(500) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventModuleHealth_Status CHECK (status IN ('healthy','degraded','failed','unknown'))
);
CREATE TABLE EventTelemetryDiagnostics (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    recorded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    component NVARCHAR(50) NOT NULL,
    vehicle_id INT NULL,
    route INT NULL,
    report_timestamp DATETIME2 NULL,
    reason NVARCHAR(100) NOT NULL,
    detail NVARCHAR(500) NULL
);
CREATE INDEX IX_EventTelemetryDiagnostics_Recorded ON EventTelemetryDiagnostics(recorded_at);
CREATE TABLE EventTelemetryMaintenance (
    id TINYINT NOT NULL PRIMARY KEY,
    last_started_at DATETIME2 NULL,
    last_success_at DATETIME2 NULL,
    last_error NVARCHAR(500) NULL,
    last_positions_deleted INT NOT NULL DEFAULT 0,
    last_diagnostics_deleted INT NOT NULL DEFAULT 0,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
INSERT INTO EventTelemetryMaintenance(id) VALUES (1);
GO
PRINT 'Migration 038 applied: Event Monitoring health and retention state created.';
