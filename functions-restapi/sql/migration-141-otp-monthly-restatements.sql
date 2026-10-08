-- Migration 141: record it when Avail restates a closed month.
--
-- The question OnBoard could not answer, found during the OTP Compliance
-- validation for Rob (docs/handoffs/otp-compliance-validation-plan-2026-09-22,
-- finding F1): "what did we assess on, and has the source moved since?"
--
-- Two things stopped it. The monthly upsert set updated_at = SYSUTCDATETIME()
-- on every MERGE match, whether or not a single value had changed, so after
-- every nightly poll every row in the trailing window carried today's stamp
-- and updated_at said only "the poller ran". And nothing anywhere kept the
-- previous figure, so even a detected change could not say what it changed
-- from.
--
-- A restatement matters because the contractor's figure is assessed from these
-- rows. If August is assessed at 83.62% and Avail later publishes different
-- August numbers, OnBoard would adopt them silently: a finalized assessment is
-- frozen (ADR 0006), but the live figure beside it would move, and nobody
-- could say when or by how much.
--
-- WHAT COUNTS AS A RESTATEMENT. A change to a row whose service month is over.
-- Inside its own month the figure is still accumulating - the month fills as
-- service days are published, and every poll legitimately changes almost every
-- row - so a change there is completion, not restatement, and recording it
-- would bury the real thing under thousands of rows a month. Once the month is
-- past, Avail publishing a different number for it is a restatement of
-- something already reported.
--
-- No settling window, deliberately. The last service days of a month land in
-- the first days of the next, so a legitimate tail shows up here as a
-- restatement a day or two after month end. Rather than guess a cutoff that
-- would also hide real early restatements, every change is recorded and
-- DaysAfterMonthEnd travels with it, so the reader draws the line.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.OtpMonthlyRouteStopDay', 'U') IS NULL
  THROW 50141, 'Migration 141 requires OtpMonthlyRouteStopDay (migration 014).', 1;
GO

-- No foreign key to OtpMonthlyRouteStopDay: this is the history of what that
-- row used to say, and it has to outlive the row. Deliberately append-only -
-- nothing in the application updates or deletes a row here.
IF OBJECT_ID('dbo.OtpMonthlyRestatements', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OtpMonthlyRestatements (
    id                UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    service_month     CHAR(6)      NOT NULL,
    route_id          INT          NOT NULL,
    stop_id           INT          NOT NULL,
    day_of_week       NVARCHAR(20) NOT NULL,
    previous_total    INT          NULL,
    previous_ontime   INT          NULL,
    new_total         INT          NULL,
    new_ontime        INT          NULL,
    detected_at       DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OtpMonthlyRestatements_Month'
               AND object_id = OBJECT_ID('dbo.OtpMonthlyRestatements'))
  CREATE INDEX IX_OtpMonthlyRestatements_Month
    ON dbo.OtpMonthlyRestatements (service_month, detected_at DESC)
    INCLUDE (route_id, stop_id, day_of_week, previous_total, new_total);
GO

-- ---------------------------------------------------------------------------
-- The reporting view. Same conventions as migration 106: real DATE columns,
-- PascalCase names, read-only to mvta_reporting_ro.
--
-- Deltas are published rather than left to the reader, because the whole point
-- is answering "by how much" without anyone having to reconstruct it. A
-- restatement that added departures and one that removed them are different
-- conversations with the contractor.
-- ---------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_OtpRestatement AS
SELECT
  r.id RestatementId,
  CONVERT(date, CONCAT(LEFT(r.service_month, 4), '-', RIGHT(r.service_month, 2), '-01')) ServiceMonthStart,
  r.service_month ServiceMonth,
  r.route_id RouteId,
  COALESCE(classification.route_label, otp.route_label) RouteLabel,
  r.stop_id StopId,
  otp.stop_name StopName,
  r.day_of_week DayOfWeek,
  r.previous_total PreviousTotalDepartures,
  r.new_total NewTotalDepartures,
  ISNULL(r.new_total, 0) - ISNULL(r.previous_total, 0) TotalDepartureDelta,
  r.previous_ontime PreviousOnTimeDepartures,
  r.new_ontime NewOnTimeDepartures,
  ISNULL(r.new_ontime, 0) - ISNULL(r.previous_ontime, 0) OnTimeDepartureDelta,
  r.detected_at DetectedAt,
  -- How long after the month ended Avail moved it. A day or two is the
  -- month's own tail arriving; weeks later is a genuine restatement.
  DATEDIFF(day,
    EOMONTH(CONVERT(date, CONCAT(LEFT(r.service_month, 4), '-', RIGHT(r.service_month, 2), '-01'))),
    CONVERT(date, r.detected_at)) DaysAfterMonthEnd
FROM dbo.OtpMonthlyRestatements r
LEFT JOIN dbo.OtpMonthlyRouteStopDay otp
  ON otp.service_month = r.service_month AND otp.route_id = r.route_id
 AND otp.stop_id = r.stop_id AND otp.day_of_week = r.day_of_week
LEFT JOIN dbo.RouteClassification classification
  ON classification.route_id = r.route_id;
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mvta_reporting_ro')
  GRANT SELECT ON dbo.vw_OtpRestatement TO mvta_reporting_ro;
GO

PRINT 'Migration 141 applied: OtpMonthlyRestatements created, vw_OtpRestatement publishes what a closed month used to say.';
GO
