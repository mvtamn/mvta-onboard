-- Migration 020: OtpDailyRouteStopHour - sub-monthly OTP trending.
--
-- Per OTP-Feed-Evaluation-and-Recommendation (3).md's live-data
-- investigation update (2026-08-05, see otp-compliance-live-data-rethink.md):
-- OtpByRouteStopDayAgg (migration-014) is a month-level aggregate and
-- structurally cannot answer "what was OTP yesterday / this week" - passing
-- a different date within the same month returns identical rows. This
-- table backs a NEW daily pull of Avail's OtpByRouteStopDayHour feed
-- (Stop x Route x Date x Hour) so the app can compute its own rolling
-- trending views without waiting on Avail's monthly aggregation cycle.
-- OtpMonthlyRouteStopDay stays the authoritative monthly number for
-- Attachment G compliance scoring - this table is for trending/early-
-- warning visibility only, never the official record.
--
-- KNOWN UNCONFIRMED - more so than any other feed in this project: no
-- sample response was ever provided for this specific feed (every other
-- Avail feed integration at least had one example record to build the
-- field mapping from). Column names below are a best-guess by close
-- analogy to OtpMonthlyRouteStopDay's own fields (Percent*/Early/Ontime/
-- Late/Missed/ActualDepartures/Total) plus CalendarDate (matching Missed
-- Trips' convention) and Latitude/Longitude/Direction (matching AVL
-- Reports' convention), since the doc's own summary only says the feed
-- "includes lat/long, direction." Verify against a real response before
-- trusting this data for anything beyond initial testing.
--
-- Rolling window, not a permanent log (unlike FixedRouteDepartures) - the
-- poll purges rows older than 90 days on every run, since the use case is
-- trailing-N-day trending, not indefinite history.

CREATE TABLE OtpDailyRouteStopHour (
    id                BIGINT IDENTITY(1,1) PRIMARY KEY,
    calendar_date     CHAR(8)       NOT NULL, -- YYYYMMDD
    hour_of_day        TINYINT       NOT NULL,
    route_id          INT           NOT NULL,
    stop_id           INT           NOT NULL,
    stop_name         NVARCHAR(200) NULL,
    route_label       NVARCHAR(200) NULL,
    pct_early         FLOAT         NULL,
    pct_ontime        FLOAT         NULL,
    pct_late          FLOAT         NULL,
    pct_not_ontime    FLOAT         NULL,
    pct_missed        FLOAT         NULL,
    early             INT           NULL,
    ontime            INT           NULL,
    late              INT           NULL,
    missed            INT           NULL,
    actual_departures INT           NULL,
    total             INT           NULL,
    latitude          FLOAT         NULL,
    longitude         FLOAT         NULL,
    direction         NVARCHAR(20)  NULL,
    updated_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT UX_OtpDailyRouteStopHour_Key UNIQUE (calendar_date, route_id, stop_id, hour_of_day)
);
GO

CREATE INDEX IX_OtpDailyRouteStopHour_Date ON OtpDailyRouteStopHour (calendar_date);
GO

PRINT 'Migration 020 applied: OtpDailyRouteStopHour created.';
