-- Migration 140: make an approved weather date subtractable, and freeze what
-- it took out.
--
-- OtpDateExclusions has existed since migration 018 and has never moved a
-- figure. Two things stopped it:
--
--   1. Nothing could approve one. The table defaults status to 'Proposed',
--      there is no approved_by/approved_at, and the API exposes GET and POST
--      only - so no row could ever reach the 'Approved' state that
--      measureOtpMonth already looks for. The console's Weather page recorded
--      weather days into a state nothing read.
--
--   2. Avail's monthly feed (OtpMonthlyRouteStopDay) is keyed by day of week,
--      not date, so "the 7th" cannot be removed from a bucket holding every
--      Monday. ADR 0033 recorded that as a limitation of the measurement, and
--      the console says so rather than leaving a reviewer guessing.
--
-- The second reason no longer holds. The daily feed (OtpDailyRouteStopHour,
-- migration 020) does carry a real calendar date, and on 2026-09-22 the two
-- feeds were shown to reconcile exactly: subtracting daily 2026-09-14 from
-- September's Monday bucket leaves a residual that is exactly zero on every
-- weekday-only route and, on the eight routes that run Sundays, equals Labor
-- Day at its Sunday level. Two independently polled Avail operations, agreeing
-- to the departure. A calendar date can be isolated from a monthly figure.
--
-- So the date's own departures are SNAPSHOT when the exclusion is approved,
-- not subtracted live. Three reasons, each load-bearing:
--
--   * The daily feed purges at 90 days (migration 020) and holds nothing
--     before 2026-09-14, when its polling window was corrected. A live
--     subtraction would quietly stop subtracting once the date aged out, and
--     the assessed figure would move on its own.
--   * A dispute is about what was taken out, not about what Avail says today.
--     A frozen row is evidence; a recomputation is an opinion.
--   * Avail restates. The snapshot is what the reviewer approved, whatever the
--     source does afterwards.
--
-- Raw is not touched. The subtraction lands on the assessable figure only, the
-- same place an approved stop exclusion lands, so Raw - Excluded = Assessable
-- still holds and the raw number still reconciles to Avail's own report.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.OtpDateExclusions', 'U') IS NULL
  THROW 50140, 'Migration 140 requires OtpDateExclusions (migration 018).', 1;
IF OBJECT_ID('dbo.OtpDailyRouteStopHour', 'U') IS NULL
  THROW 50140, 'Migration 140 requires OtpDailyRouteStopHour (migration 020).', 1;
GO

-- Approval, which the table has never had. Kept nullable: every existing row
-- is 'Proposed' and stays that way until somebody approves it on purpose.
IF COL_LENGTH('dbo.OtpDateExclusions', 'approved_by') IS NULL
  ALTER TABLE dbo.OtpDateExclusions ADD approved_by NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.OtpDateExclusions', 'approved_at') IS NULL
  ALTER TABLE dbo.OtpDateExclusions ADD approved_at DATETIME2 NULL;
GO
-- When the departures below were frozen, and from which feed. A row approved
-- before this migration - there are none today - would carry NULL here and
-- subtract nothing, which is the safe direction.
IF COL_LENGTH('dbo.OtpDateExclusions', 'snapshot_taken_at') IS NULL
  ALTER TABLE dbo.OtpDateExclusions ADD snapshot_taken_at DATETIME2 NULL;
GO

-- What the excluded date actually carried, at the grain the monthly feed is
-- measured on: route, stop, day of week. day_of_week is stored rather than
-- derived so the subtraction joins the monthly row directly, and so the
-- Avail spelling in force when the snapshot was taken is preserved with it -
-- the feed says 'Tues' and 'Thur', not 'Tue' and 'Thu'.
IF OBJECT_ID('dbo.OtpDateExclusionDepartures', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OtpDateExclusionDepartures (
    id            UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    exclusion_id  UNIQUEIDENTIFIER NOT NULL,
    service_month CHAR(6)       NOT NULL,
    route_id      INT           NOT NULL,
    stop_id       INT           NOT NULL,
    day_of_week   NVARCHAR(20)  NOT NULL,
    total         INT           NOT NULL DEFAULT 0,
    ontime        INT           NOT NULL DEFAULT 0,
    early         INT           NOT NULL DEFAULT 0,
    late          INT           NOT NULL DEFAULT 0,
    missed        INT           NOT NULL DEFAULT 0,
    created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_OtpDateExclusionDepartures_Exclusion
      FOREIGN KEY (exclusion_id) REFERENCES dbo.OtpDateExclusions(id) ON DELETE CASCADE,
    CONSTRAINT UQ_OtpDateExclusionDepartures
      UNIQUE (exclusion_id, route_id, stop_id)
  );
END
GO

-- The subtraction reads by month and joins on the measurement's own key.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OtpDateExclusionDepartures_Month'
               AND object_id = OBJECT_ID('dbo.OtpDateExclusionDepartures'))
  CREATE INDEX IX_OtpDateExclusionDepartures_Month
    ON dbo.OtpDateExclusionDepartures (service_month, route_id, stop_id, day_of_week)
    INCLUDE (total, ontime);
GO

-- ---------------------------------------------------------------------------
-- vw_OtpMonthlyRouteStop gains the date subtraction.
--
-- Migration 106 published the stop rule as IsAssessable, a per-row flag, and
-- documented the contract as "sum OnTime/Total where IsAssessable = 1". A date
-- exclusion does not remove a row - it reduces one, because the row is every
-- Monday and only one Monday came out - so a boolean cannot carry it.
--
-- The row therefore also publishes what the excluded dates took out of it, and
-- the assessable counts with that already applied. The contract becomes: sum
-- AssessableTotalDepartures / AssessableOnTimeDepartures. Summing the old way
-- still answers the question it always answered - the figure before weather -
-- which is worth keeping visible rather than folding away.
--
-- Nothing is recomputed here: the subtraction is the frozen snapshot, and the
-- same expression is generated by lib/otpMonth/rules.ts for the application.
-- rules.test.ts reads this file and fails if the two drift apart.
-- ---------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_OtpMonthlyRouteStop AS
SELECT
  CONVERT(date, CONCAT(LEFT(otp.service_month, 4), '-', RIGHT(otp.service_month, 2), '-01')) ServiceMonthStart,
  otp.service_month ServiceMonth,
  otp.route_id RouteId,
  COALESCE(classification.route_label, otp.route_label) RouteLabel,
  otp.stop_id StopId,
  otp.stop_name StopName,
  otp.day_of_week DayOfWeek,
  ISNULL(classification.route_category, N'FixedRoute') RouteCategory,
  CONVERT(bit, CASE WHEN ISNULL(classification.route_category, N'FixedRoute') = N'FixedRoute'
                     AND exclusion.id IS NULL THEN 1 ELSE 0 END) IsAssessable,
  CONVERT(bit, CASE WHEN exclusion.id IS NULL THEN 0 ELSE 1 END) IsStopExcluded,
  exclusion.reason_code ExclusionReasonCode,
  reason.label ExclusionReasonLabel,
  exclusion.reviewed_by ExclusionApprovedBy,
  exclusion.reviewed_at ExclusionApprovedAt,
  otp.early EarlyDepartures,
  otp.ontime OnTimeDepartures,
  otp.late LateDepartures,
  otp.missed MissedDepartures,
  otp.actual_departures ActualDepartures,
  otp.total TotalDepartures,
  -- What approved date exclusions took out of this row.
  ISNULL(dates.total, 0) DateExcludedDepartures,
  ISNULL(dates.ontime, 0) DateExcludedOnTimeDepartures,
  -- The assessable counts, with both rules applied. Clamped at zero: a
  -- snapshot larger than the row it subtracts from means the monthly feed was
  -- restated downward after approval, and a negative departure count is not a
  -- thing a report should ever be handed.
  CASE WHEN ISNULL(classification.route_category, N'FixedRoute') = N'FixedRoute' AND exclusion.id IS NULL
       THEN CASE WHEN ISNULL(otp.total, 0) - ISNULL(dates.total, 0) > 0
                 THEN ISNULL(otp.total, 0) - ISNULL(dates.total, 0) ELSE 0 END
       ELSE 0 END AssessableTotalDepartures,
  CASE WHEN ISNULL(classification.route_category, N'FixedRoute') = N'FixedRoute' AND exclusion.id IS NULL
       THEN CASE WHEN ISNULL(otp.ontime, 0) - ISNULL(dates.ontime, 0) > 0
                 THEN ISNULL(otp.ontime, 0) - ISNULL(dates.ontime, 0) ELSE 0 END
       ELSE 0 END AssessableOnTimeDepartures,
  otp.pct_early PctEarly,
  otp.pct_ontime PctOnTime,
  otp.pct_late PctLate,
  otp.pct_not_ontime PctNotOnTime,
  otp.pct_missed PctMissed,
  CONVERT(bit, 1) IsOfficialRecord,
  otp.first_seen_at FirstSeenAt,
  otp.updated_at UpdatedAt
FROM dbo.OtpMonthlyRouteStopDay otp
LEFT JOIN dbo.RouteClassification classification
  ON classification.route_id = otp.route_id
LEFT JOIN dbo.OtpStopExclusions exclusion
  ON exclusion.service_month = otp.service_month
 AND exclusion.route_id = otp.route_id
 AND exclusion.stop_id = otp.stop_id
 AND exclusion.day_of_week = otp.day_of_week
 AND exclusion.status = 'approved'
LEFT JOIN dbo.OtpReasonCodes reason
  ON reason.code = exclusion.reason_code
 AND reason.applies_to = 'stop'
LEFT JOIN (
  SELECT d.service_month, d.route_id, d.stop_id, d.day_of_week,
         SUM(d.total) total, SUM(d.ontime) ontime
  FROM dbo.OtpDateExclusionDepartures d
  JOIN dbo.OtpDateExclusions e ON e.id = d.exclusion_id AND e.status = 'Approved'
  GROUP BY d.service_month, d.route_id, d.stop_id, d.day_of_week
) dates
  ON dates.service_month = otp.service_month
 AND dates.route_id = otp.route_id
 AND dates.stop_id = otp.stop_id
 AND dates.day_of_week = otp.day_of_week;
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mvta_reporting_ro')
  GRANT SELECT ON dbo.vw_OtpMonthlyRouteStop TO mvta_reporting_ro;
GO

PRINT 'Migration 140 applied: OtpDateExclusions gains approval + snapshot columns, OtpDateExclusionDepartures created, vw_OtpMonthlyRouteStop publishes the date subtraction.';
GO
