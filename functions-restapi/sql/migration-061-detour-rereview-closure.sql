IF COL_LENGTH('dbo.Detours', 'review_status') IS NULL
BEGIN
  ALTER TABLE dbo.Detours ADD review_status NVARCHAR(20) NOT NULL CONSTRAINT DF_Detours_ReviewStatus DEFAULT 'current';
  ALTER TABLE dbo.Detours ADD review_reason NVARCHAR(1000) NULL;
  ALTER TABLE dbo.Detours ADD closure_reason NVARCHAR(1000) NULL;
  ALTER TABLE dbo.Detours ADD closed_by NVARCHAR(200) NULL;
  ALTER TABLE dbo.Detours ADD closed_at DATETIME2(3) NULL;
  -- Through EXEC: this batch is compiled before any of it runs, so naming
  -- review_status here directly fails with "Invalid column name" and the whole
  -- batch is abandoned - nothing added, quietly enough to look like a clean
  -- run. That is what kept this migration off dev until 2026-09-18, and what
  -- made the Detours pages answer 500. Same shape as migration 092's fix.
  EXEC(N'ALTER TABLE dbo.Detours ADD CONSTRAINT CK_Detours_ReviewStatus
    CHECK (review_status IN (''current'', ''needs_review''))');
END;
GO
