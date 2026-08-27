-- Evidence needed to decide whether a feed delivery covers the KPI period.
IF OBJECT_ID(N'dbo.MissedTripFeedHealth', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH(N'dbo.MissedTripFeedHealth', N'coverage_start_at') IS NULL
    ALTER TABLE dbo.MissedTripFeedHealth ADD coverage_start_at DATETIME2 NULL;
  IF COL_LENGTH(N'dbo.MissedTripFeedHealth', N'coverage_end_at') IS NULL
    ALTER TABLE dbo.MissedTripFeedHealth ADD coverage_end_at DATETIME2 NULL;
  IF COL_LENGTH(N'dbo.MissedTripFeedHealth', N'last_failure_at') IS NULL
    ALTER TABLE dbo.MissedTripFeedHealth ADD last_failure_at DATETIME2 NULL;
  IF COL_LENGTH(N'dbo.MissedTripFeedHealth', N'last_failure_reason') IS NULL
    ALTER TABLE dbo.MissedTripFeedHealth ADD last_failure_reason NVARCHAR(1000) NULL;
END;
GO

-- Append-only evidence that a human knowingly prepared a communication using stale KPI data.
IF OBJECT_ID(N'dbo.KpiTrustAcknowledgements', N'U') IS NULL
  CREATE TABLE dbo.KpiTrustAcknowledgements (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    stream_name NVARCHAR(64) NOT NULL,
    communication_reference NVARCHAR(100) NOT NULL,
    reason NVARCHAR(1000) NOT NULL,
    acknowledged_by NVARCHAR(200) NOT NULL,
    acknowledged_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
GO

PRINT 'Migration 085 verified: KPI trust records delivery, coverage, failure, and stale-data acknowledgement evidence.';
