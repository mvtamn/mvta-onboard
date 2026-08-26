-- App-owned Procedure Drafts and immutable Supporting Document References.
-- SharePoint identities identify stored documents; they never import Matrix content.

CREATE TABLE Procedures (
    procedure_id NVARCHAR(100) NOT NULL PRIMARY KEY,
    condition_key NVARCHAR(100) NOT NULL UNIQUE,
    condition NVARCHAR(200) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by NVARCHAR(200) NOT NULL
);
GO

CREATE TABLE ProcedureRevisions (
    procedure_id NVARCHAR(100) NOT NULL,
    revision INT NOT NULL,
    lifecycle_state NVARCHAR(30) NOT NULL DEFAULT 'Draft',
    severity NVARCHAR(30) NULL,
    severity_meaning NVARCHAR(300) NULL,
    owner_team NVARCHAR(200) NULL,
    owner_contact NVARCHAR(320) NULL,
    effective_at DATETIME2 NULL,
    next_review_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by NVARCHAR(200) NOT NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(200) NOT NULL,
    row_version ROWVERSION NOT NULL,
    CONSTRAINT PK_ProcedureRevisions PRIMARY KEY (procedure_id, revision),
    CONSTRAINT FK_ProcedureRevisions_Procedure FOREIGN KEY (procedure_id) REFERENCES Procedures(procedure_id),
    CONSTRAINT CK_ProcedureRevisions_Lifecycle CHECK (lifecycle_state IN ('Draft', 'Under review', 'Approved', 'Superseded', 'Retired')),
    CONSTRAINT CK_ProcedureRevisions_Severity CHECK (severity IS NULL OR severity IN ('Stop service', 'Restrict service', 'Routine / no escalation'))
);
GO

CREATE TABLE ProcedureCriteria (
    criterion_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    procedure_id NVARCHAR(100) NOT NULL,
    revision INT NOT NULL,
    sort_order INT NOT NULL,
    criterion_kind NVARCHAR(10) NOT NULL,
    criterion_text NVARCHAR(1000) NOT NULL,
    CONSTRAINT FK_ProcedureCriteria_Revision FOREIGN KEY (procedure_id, revision) REFERENCES ProcedureRevisions(procedure_id, revision) ON DELETE CASCADE,
    CONSTRAINT UQ_ProcedureCriteria_Order UNIQUE (procedure_id, revision, sort_order),
    CONSTRAINT CK_ProcedureCriteria_Kind CHECK (criterion_kind IN ('applies', 'excludes')),
    CONSTRAINT CK_ProcedureCriteria_Order CHECK (sort_order > 0)
);
GO

CREATE TABLE ProcedureImmediateActions (
    action_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    procedure_id NVARCHAR(100) NOT NULL,
    revision INT NOT NULL,
    sort_order INT NOT NULL,
    action_kind NVARCHAR(20) NOT NULL,
    instruction NVARCHAR(2000) NOT NULL,
    CONSTRAINT FK_ProcedureImmediateActions_Revision FOREIGN KEY (procedure_id, revision) REFERENCES ProcedureRevisions(procedure_id, revision) ON DELETE CASCADE,
    CONSTRAINT UQ_ProcedureImmediateActions_Order UNIQUE (procedure_id, revision, sort_order),
    CONSTRAINT CK_ProcedureImmediateActions_Kind CHECK (action_kind IN ('required', 'conditional', 'informational')),
    CONSTRAINT CK_ProcedureImmediateActions_Order CHECK (sort_order > 0)
);
GO

CREATE TABLE ProcedureDocumentReferences (
    reference_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    procedure_id NVARCHAR(100) NOT NULL,
    revision INT NOT NULL,
    sort_order INT NOT NULL,
    document_type NVARCHAR(20) NOT NULL,
    is_primary BIT NOT NULL DEFAULT 0,
    document_code NVARCHAR(100) NOT NULL,
    site_id NVARCHAR(200) NOT NULL,
    drive_id NVARCHAR(200) NOT NULL,
    item_id NVARCHAR(200) NOT NULL,
    expected_version NVARCHAR(200) NOT NULL,
    expected_file_name NVARCHAR(500) NOT NULL,
    expected_mime_type NVARCHAR(200) NOT NULL,
    web_url NVARCHAR(2000) NOT NULL,
    health_status NVARCHAR(20) NOT NULL DEFAULT 'Needs review',
    checked_at DATETIME2 NULL,
    observed_version NVARCHAR(200) NULL,
    observed_file_name NVARCHAR(500) NULL,
    observed_mime_type NVARCHAR(200) NULL,
    health_reason NVARCHAR(500) NULL,
    CONSTRAINT FK_ProcedureDocumentReferences_Revision FOREIGN KEY (procedure_id, revision) REFERENCES ProcedureRevisions(procedure_id, revision) ON DELETE CASCADE,
    CONSTRAINT UQ_ProcedureDocumentReferences_Order UNIQUE (procedure_id, revision, sort_order),
    CONSTRAINT UQ_ProcedureDocumentReferences_Item UNIQUE (procedure_id, revision, site_id, drive_id, item_id),
    CONSTRAINT CK_ProcedureDocumentReferences_Type CHECK (document_type IN ('SOP', 'Reference', 'Form', 'Map', 'QRG', 'Visual rendition')),
    CONSTRAINT CK_ProcedureDocumentReferences_Health CHECK (health_status IN ('Valid', 'Needs review', 'Unavailable')),
    CONSTRAINT CK_ProcedureDocumentReferences_Order CHECK (sort_order > 0),
    CONSTRAINT CK_ProcedureDocumentReferences_Primary CHECK (is_primary = 0 OR document_type IN ('SOP', 'Reference'))
);
GO

CREATE UNIQUE INDEX UX_ProcedureDocumentReferences_OnePrimary
    ON ProcedureDocumentReferences (procedure_id, revision)
    WHERE is_primary = 1;
GO

PRINT 'Migration 076 applied: app-owned Procedure Drafts and Supporting Document References created.';
