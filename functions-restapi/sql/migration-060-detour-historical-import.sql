IF OBJECT_ID('dbo.DetourHistoricalImports', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DetourHistoricalImports (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DetourHistoricalImports PRIMARY KEY DEFAULT NEWID(),
    import_batch_id UNIQUEIDENTIFIER NOT NULL,
    source_file NVARCHAR(255) NOT NULL,
    source_row_number INT NOT NULL,
    historical_reference NVARCHAR(100) NULL,
    closure NVARCHAR(500) NOT NULL,
    service_date NVARCHAR(50) NULL,
    routes NVARCHAR(500) NULL,
    communication_audience NVARCHAR(200) NULL,
    communication_channel NVARCHAR(200) NULL,
    communication_recipients NVARCHAR(1000) NULL,
    communication_content NVARCHAR(4000) NULL,
    communicated_at DATETIME2(3) NULL,
    raw_row_json NVARCHAR(MAX) NOT NULL,
    imported_by NVARCHAR(200) NOT NULL,
    imported_at DATETIME2(3) NOT NULL CONSTRAINT DF_DetourHistoricalImports_ImportedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_DetourHistoricalImports_BatchRow UNIQUE (import_batch_id, source_row_number)
  );
  CREATE INDEX IX_DetourHistoricalImports_Reference ON dbo.DetourHistoricalImports(historical_reference);
END;
GO
