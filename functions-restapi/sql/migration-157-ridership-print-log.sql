-- Migration 157: the Count Sheet print log (plans/ridership-build-plan.md PR 4,
-- bulk-printing evaluation 2026-10-31).
--
-- Each garage's check-in desk prints the next service date's Count Sheets as
-- one PDF, in pull-out order. The log answers three questions the desk and
-- OCC ask in the evening:
--   * has this garage printed tomorrow's sheets yet, and who printed them;
--   * has the Dispatch Log changed a block since it was printed (a late
--     tripper, a schedule fix), so the desk is handing out a stale sheet;
--   * which blocks need a reprint - only those, not the whole stack.
--
--   * RidershipPrintRuns - one per PDF produced: the service date, the garage
--     (NULL is Unassigned), whether it was the garage's stack or a reprint of
--     some blocks, blank backs, and who printed it when.
--   * RidershipPrintedSheets - the blocks in that PDF, each with a fingerprint
--     of the trips printed on it. A block whose current trips no longer match
--     its latest fingerprint has changed since printing.
--
-- Re-runnable: every object is created only when missing.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.RidershipSheets', 'U') IS NULL
  THROW 50157, 'Migration 157 requires the ridership tables (migration 153).', 1;
GO

IF OBJECT_ID('dbo.RidershipPrintRuns', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipPrintRuns (
    print_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RidershipPrintRuns_id DEFAULT NEWID(),
    service_date  CHAR(8)          NOT NULL,     -- YYYYMMDD agency-local, as TripStartLog
    garage        NVARCHAR(50)     NULL,          -- NULL: the Unassigned blocks
    scope         NVARCHAR(10)     NOT NULL,      -- 'garage': the whole stack; 'blocks': a reprint of some
    blank_backs   BIT              NOT NULL,
    sheet_count   INT              NOT NULL,
    page_count    INT              NOT NULL,
    printed_at    DATETIME2        NOT NULL CONSTRAINT DF_RidershipPrintRuns_printed DEFAULT SYSUTCDATETIME(),
    printed_by    NVARCHAR(200)    NOT NULL,
    CONSTRAINT PK_RidershipPrintRuns PRIMARY KEY (print_id),
    CONSTRAINT CK_RidershipPrintRuns_Scope CHECK (scope IN ('garage', 'blocks'))
  );
  CREATE INDEX IX_RidershipPrintRuns_Date ON dbo.RidershipPrintRuns (service_date, printed_at);
END;
GO

IF OBJECT_ID('dbo.RidershipPrintedSheets', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipPrintedSheets (
    print_id      UNIQUEIDENTIFIER NOT NULL,
    service_date  CHAR(8)          NOT NULL,
    block         CHAR(3)          NOT NULL,
    fingerprint   CHAR(64)         NOT NULL,      -- SHA-256 hex of the trips printed on the sheet
    pages         INT              NOT NULL,
    CONSTRAINT PK_RidershipPrintedSheets PRIMARY KEY (print_id, block),
    CONSTRAINT FK_RidershipPrintedSheets_Run FOREIGN KEY (print_id) REFERENCES dbo.RidershipPrintRuns (print_id),
    CONSTRAINT CK_RidershipPrintedSheets_Block CHECK (block LIKE '[0-9][0-9][0-9]')
  );
  CREATE INDEX IX_RidershipPrintedSheets_Sheet ON dbo.RidershipPrintedSheets (service_date, block);
END;
GO

PRINT 'Migration 157: the Count Sheet print log is in place.';
GO
