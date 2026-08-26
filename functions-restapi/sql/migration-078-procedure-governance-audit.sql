-- Procedure governance decisions are append-only evidence. They never alter
-- the frozen content owned by an approved Procedure Revision.

CREATE TABLE ProcedureAuditEvents (
    event_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    procedure_id NVARCHAR(100) NOT NULL,
    revision INT NOT NULL,
    event_type NVARCHAR(50) NOT NULL,
    actor NVARCHAR(200) NOT NULL,
    reason NVARCHAR(1000) NULL,
    details_json NVARCHAR(MAX) NOT NULL DEFAULT N'{}',
    occurred_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_ProcedureAuditEvents_Details CHECK (ISJSON(details_json) = 1)
);
GO

CREATE INDEX IX_ProcedureAuditEvents_Revision ON ProcedureAuditEvents(procedure_id, revision, occurred_at DESC);
GO

PRINT 'Migration 078 applied: Procedure lifecycle and document-health audit events created.';
