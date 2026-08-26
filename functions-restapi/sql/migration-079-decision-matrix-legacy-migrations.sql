CREATE TABLE DecisionMatrixLegacyMigrations (
    legacy_procedure_id NVARCHAR(100) NOT NULL,
    legacy_revision INT NOT NULL,
    governed_procedure_id NVARCHAR(100) NULL,
    governed_revision INT NULL,
    source_snapshot_json NVARCHAR(MAX) NOT NULL,
    reviewed_fields_json NVARCHAR(MAX) NOT NULL,
    mapping_outcome NVARCHAR(30) NOT NULL,
    mapped_by NVARCHAR(200) NOT NULL,
    mapped_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_DecisionMatrixLegacyMigrations PRIMARY KEY (legacy_procedure_id, legacy_revision),
    CONSTRAINT CK_DecisionMatrixLegacyMigrations_Snapshot CHECK (ISJSON(source_snapshot_json)=1),
    CONSTRAINT CK_DecisionMatrixLegacyMigrations_Reviewed CHECK (ISJSON(reviewed_fields_json)=1),
    CONSTRAINT CK_DecisionMatrixLegacyMigrations_Outcome CHECK (mapping_outcome IN ('converting','mapped','failed'))
);
GO
PRINT 'Migration 079 applied: legacy Decision Matrix migration evidence created.';
