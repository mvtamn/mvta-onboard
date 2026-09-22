-- Migration 142: declare the days that did not run a normal schedule.
--
-- Avail's monthly OTP feed is grouped by day of week, so September's "Mon" row
-- is every Monday in September added together. On 2026-09-22 that was shown to
-- include Labor Day, 2026-09-07, running a Sunday-level schedule: subtracting
-- the daily feed's 2026-09-14 from the monthly Mon bucket left a residual that
-- was exactly zero on every weekday-only route and, on the eight routes that
-- run Sundays, matched each one's Sunday volume (436: 78 vs 78, 442: 60 vs 60).
--
-- So a Monday bucket is not four comparable Mondays. It is three Mondays and a
-- Sunday wearing a Monday's name, and nothing on screen said so. That matters
-- most in the Review Queue, whose Flagged Stops are computed from each stop's
-- early and late shares *per day of week* - a stop can look biased on Mondays
-- because one of its Mondays was a holiday.
--
-- DECLARED, NOT INFERRED. The obvious alternative is to detect these from the
-- daily feed by comparing each date to its day-of-week neighbours. It was
-- tried and rejected on evidence: the daily feed keeps 90 days and held
-- nothing before 2026-09-14, so it cannot see Labor Day at all - the very day
-- that prompted this. Inference would also have been the wrong shape even with
-- coverage. MVTA schedules these days; a holiday is a fact the agency holds,
-- not a statistical anomaly to be rediscovered from volumes each month.
--
-- The daily feed is used to CORROBORATE a declaration where it has the date -
-- the same relationship ADR 0035 set up between Avail and a missed-trip case:
-- the evidence is shown, and it never decides. A declared day the feed
-- contradicts is worth seeing precisely because somebody may have declared the
-- wrong date.
--
-- DECLARING A DAY CHANGES NO FIGURE. It is a note on a bucket, not an
-- exclusion. A day that should come out of the contractor's figure is recorded
-- as a Weather/Emergency date exclusion and approved (ADR 0038, migration 140),
-- which is a separate, deliberate act with its own evidence and audit trail.
-- Keeping them apart means a reviewer can be told "this Monday is unusual"
-- without anybody's assessment moving because of a label.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.OtpMonthlyRouteStopDay', 'U') IS NULL
  THROW 50142, 'Migration 142 requires OtpMonthlyRouteStopDay (migration 014).', 1;
GO

IF OBJECT_ID('dbo.OtpReducedServiceDays', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OtpReducedServiceDays (
    id                UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    service_date      CHAR(8)       NOT NULL,
    -- Avail's own spelling for the date's day of week, stamped by the
    -- application when the day is declared, for the same reason migration 140
    -- stores it: the feed says 'Tues' and 'Thur', and a bucket is only matched
    -- if the strings match exactly.
    day_of_week       NVARCHAR(20)  NOT NULL,
    label             NVARCHAR(120) NOT NULL,   -- 'Labor Day'
    schedule_operated NVARCHAR(60)  NOT NULL,   -- 'Sunday schedule'
    notes             NVARCHAR(500) NULL,
    declared_by       NVARCHAR(200) NOT NULL,
    declared_at       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    -- One declaration per date. Re-declaring updates in place rather than
    -- leaving two labels on one day.
    CONSTRAINT UQ_OtpReducedServiceDays_Date UNIQUE (service_date)
  );
END
GO

-- Read by month, which is how every consumer asks.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OtpReducedServiceDays_Month'
               AND object_id = OBJECT_ID('dbo.OtpReducedServiceDays'))
  CREATE INDEX IX_OtpReducedServiceDays_Month
    ON dbo.OtpReducedServiceDays (service_date)
    INCLUDE (day_of_week, label, schedule_operated);
GO

-- ---------------------------------------------------------------------------
-- Reporting. A report reading vw_OtpMonthlyRouteStop by DayOfWeek is subject
-- to exactly the distortion this migration exists to name, so the days are
-- published for joining on.
-- ---------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_OtpReducedServiceDay AS
SELECT
  d.id ReducedServiceDayId,
  CONVERT(date, d.service_date, 112) ServiceDate,
  LEFT(d.service_date, 6) ServiceMonth,
  CONVERT(date, CONCAT(LEFT(d.service_date, 4), '-', SUBSTRING(d.service_date, 5, 2), '-01')) ServiceMonthStart,
  d.day_of_week DayOfWeek,
  d.label Label,
  d.schedule_operated ScheduleOperated,
  d.notes Notes,
  d.declared_by DeclaredBy,
  d.declared_at DeclaredAt
FROM dbo.OtpReducedServiceDays d;
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mvta_reporting_ro')
  GRANT SELECT ON dbo.vw_OtpReducedServiceDay TO mvta_reporting_ro;
GO

PRINT 'Migration 142 applied: OtpReducedServiceDays created, vw_OtpReducedServiceDay published.';
GO
