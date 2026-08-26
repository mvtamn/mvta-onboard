-- Searchable controlled tags and source-qualified Procedure Match Rules.
-- Procedure text remains OnBoard-owned; SharePoint remains document storage only.

ALTER TABLE ProcedureRevisions ADD tags_json NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ProcedureRevisions_Tags DEFAULT '[]';
GO

CREATE TABLE ProcedureMatchRules (
    match_rule_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    source_type NVARCHAR(30) NOT NULL,
    source_qualifier NVARCHAR(200) NOT NULL,
    procedure_id NVARCHAR(100) NOT NULL,
    priority INT NOT NULL,
    explanation NVARCHAR(1000) NOT NULL,
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by NVARCHAR(200) NOT NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(200) NOT NULL,
    CONSTRAINT FK_ProcedureMatchRules_Procedure FOREIGN KEY (procedure_id) REFERENCES Procedures(procedure_id),
    CONSTRAINT CK_ProcedureMatchRules_Source CHECK (source_type IN ('SuggestedAlert', 'ServiceRisk')),
    CONSTRAINT CK_ProcedureMatchRules_Priority CHECK (priority > 0),
    CONSTRAINT UQ_ProcedureMatchRules_SourcePriority UNIQUE (source_type, source_qualifier, priority)
);
GO

CREATE INDEX IX_ProcedureMatchRules_Lookup ON ProcedureMatchRules (source_type, source_qualifier, is_active, priority);
GO

PRINT 'Migration 080 applied: Decision Matrix search tags and source-qualified match rules created.';
