IF OBJECT_ID('dbo.RouteClassificationHistory', 'U') IS NULL
BEGIN
  CREATE TABLE RouteClassificationHistory (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    route_id INT NOT NULL,
    route_category NVARCHAR(20) NOT NULL,
    route_label NVARCHAR(100) NULL,
    effective_start_date CHAR(8) NULL,
    effective_end_date CHAR(8) NULL,
    is_active BIT NOT NULL,
    changed_by NVARCHAR(200) NULL,
    changed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_RouteClassificationHistory_RouteDate
    ON RouteClassificationHistory(route_id, effective_start_date, effective_end_date);
END;
GO
PRINT 'Migration 039 applied: classification history and admin safeguards ready.';
