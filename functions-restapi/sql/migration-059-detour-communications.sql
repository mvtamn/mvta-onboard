IF OBJECT_ID('dbo.DetourCommunications', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DetourCommunications (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DetourCommunications PRIMARY KEY DEFAULT NEWID(),
    detour_id UNIQUEIDENTIFIER NOT NULL,
    audience NVARCHAR(100) NOT NULL,
    channel NVARCHAR(100) NOT NULL,
    recipients NVARCHAR(2000) NULL,
    content NVARCHAR(4000) NOT NULL,
    status NVARCHAR(20) NOT NULL CONSTRAINT DF_DetourCommunications_Status DEFAULT 'draft',
    outcome NVARCHAR(500) NULL,
    created_by NVARCHAR(200) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_DetourCommunications_CreatedAt DEFAULT SYSUTCDATETIME(),
    published_by NVARCHAR(200) NULL,
    published_at DATETIME2(3) NULL,
    CONSTRAINT FK_DetourCommunications_Detour FOREIGN KEY (detour_id) REFERENCES dbo.Detours(id),
    CONSTRAINT CK_DetourCommunications_Status CHECK (status IN ('draft', 'published', 'failed'))
  );
  CREATE INDEX IX_DetourCommunications_Detour ON dbo.DetourCommunications(detour_id, created_at DESC);
END;
GO
