IF COL_LENGTH('dbo.Detours', 'review_status') IS NULL
BEGIN
  ALTER TABLE dbo.Detours ADD review_status NVARCHAR(20) NOT NULL CONSTRAINT DF_Detours_ReviewStatus DEFAULT 'current';
  ALTER TABLE dbo.Detours ADD review_reason NVARCHAR(1000) NULL;
  ALTER TABLE dbo.Detours ADD closure_reason NVARCHAR(1000) NULL;
  ALTER TABLE dbo.Detours ADD closed_by NVARCHAR(200) NULL;
  ALTER TABLE dbo.Detours ADD closed_at DATETIME2(3) NULL;
  ALTER TABLE dbo.Detours ADD CONSTRAINT CK_Detours_ReviewStatus CHECK (review_status IN ('current', 'needs_review'));
END;
GO
