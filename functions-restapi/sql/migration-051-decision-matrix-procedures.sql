-- Governed Procedure and Decision Matrix Entry content.
-- SharePoint remains the full-document source; this table stores the
-- searchable summary, source metadata, lifecycle, and exact revision identity.

CREATE TABLE DecisionMatrixProcedures (
    procedure_id              NVARCHAR(100) NOT NULL,
    revision                  INT NOT NULL,
    condition_key             NVARCHAR(100) NOT NULL,
    condition                 NVARCHAR(200) NOT NULL,
    criteria                  NVARCHAR(MAX) NOT NULL,
    severity                  NVARCHAR(30) NOT NULL,
    severity_meaning          NVARCHAR(300) NULL,
    immediate_actions_json    NVARCHAR(MAX) NOT NULL,
    escalation_triggers_json  NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    notifications_json        NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    communication_guidance    NVARCHAR(MAX) NULL,
    required_documentation    NVARCHAR(MAX) NULL,
    tags_json                 NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    service_mode              NVARCHAR(50) NULL,
    affected_workflow         NVARCHAR(100) NULL,
    urgency                   NVARCHAR(30) NULL,
    document_type             NVARCHAR(10) NOT NULL,
    document_code             NVARCHAR(100) NOT NULL,
    source_url                NVARCHAR(2000) NULL,
    source_revision           NVARCHAR(200) NULL,
    owner                     NVARCHAR(200) NULL,
    approver                  NVARCHAR(200) NULL,
    approval_state            NVARCHAR(30) NOT NULL DEFAULT 'Preview',
    trust_state               NVARCHAR(30) NOT NULL DEFAULT 'Preview',
    effective_at              DATETIME2 NULL,
    next_review_at            DATETIME2 NULL,
    retired_at                DATETIME2 NULL,
    source_status             NVARCHAR(30) NOT NULL DEFAULT 'available',
    last_synced_at            DATETIME2 NULL,
    updated_at                DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by                NVARCHAR(200) NULL,
    PRIMARY KEY (procedure_id, revision),
    CONSTRAINT CK_DecisionMatrix_ApprovalState CHECK (approval_state IN ('Preview', 'Approved', 'Retired')),
    CONSTRAINT CK_DecisionMatrix_TrustState CHECK (trust_state IN ('Approved', 'Preview', 'Needs review', 'Stale', 'Partial', 'Unavailable', 'Retired')),
    CONSTRAINT CK_DecisionMatrix_SourceStatus CHECK (source_status IN ('available', 'partial', 'unavailable')),
    CONSTRAINT CK_DecisionMatrix_DocumentType CHECK (document_type IN ('SOP', 'REF')),
    CONSTRAINT CK_DecisionMatrix_ActionsJson CHECK (ISJSON(immediate_actions_json) = 1),
    CONSTRAINT CK_DecisionMatrix_TagsJson CHECK (ISJSON(tags_json) = 1)
);
GO

CREATE INDEX IX_DecisionMatrix_Current
    ON DecisionMatrixProcedures (approval_state, trust_state, condition_key);
GO

INSERT INTO DecisionMatrixProcedures (
    procedure_id, revision, condition_key, condition, criteria, severity,
    severity_meaning, immediate_actions_json, escalation_triggers_json,
    notifications_json, tags_json, service_mode, affected_workflow, urgency,
    document_type, document_code, source_url, source_revision, owner, approver,
    approval_state, trust_state, effective_at, next_review_at, source_status
)
VALUES (
    'occ-vehicle-collision', 1, 'vehicle-collision', 'Vehicle Collision',
    'Any collision involving passenger or bystander injury, a second vehicle, or a blocked travel lane.',
    'Stop', 'Stop service activity and begin emergency response.',
    '["Notify command staff immediately","Dispatch EMS/police per protocol","Hold vehicle in place until cleared"]',
    '["Any injury","Blocked travel lane","Multiple vehicles involved"]',
    '["Command staff","EMS or law enforcement"]',
    '["Safety","Emergency Response"]', 'FixedRoute', 'Emergency Response', 'Immediate',
    'SOP', 'SOP-OCC-001-00',
    'https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/SOP_OCC-001-00_Vehicle_Collision.docx',
    'SOP-OCC-001-00', 'Operations Control Center', 'OCC Administration',
    'Approved', 'Approved', SYSUTCDATETIME(), DATEADD(month, 6, SYSUTCDATETIME()), 'available'
);
GO

PRINT 'Migration 051 applied: governed Decision Matrix Procedure content created.';
