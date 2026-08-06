-- Migration 021: widen OtpMonthlyRouteStopDay.day_of_week.
--
-- CONFIRMED live 2026-08-06 (see plans/otp-compliance-live-data-rethink.md):
-- once the envelope-key fix let real Avail OTP data through for the first
-- time, the live poll ("414 reports seen, 260 rows upserted for 202608")
-- hit a real SQL error on some rows: "Data type 0xE7 has an invalid data
-- length or metadata length" on @day_of_week - migration-014's own
-- NVARCHAR(3) (sized for "Mon"/"Tue"/etc., per the doc's only sample
-- record) is too narrow for at least some of Avail's real values. Exact
-- overflowing value(s) not confirmed - rather than guess the precise
-- format (full day names? a special non-day category?), widen generously
-- so this stops silently dropping rows regardless of what the real value
-- turns out to be.
--
-- day_of_week is part of the primary key, so the column, the PK
-- constraint, and any dependent index all need to move together.

ALTER TABLE OtpMonthlyRouteStopDay DROP CONSTRAINT PK_OtpMonthlyRouteStopDay;
GO

ALTER TABLE OtpMonthlyRouteStopDay ALTER COLUMN day_of_week NVARCHAR(20) NOT NULL;
GO

ALTER TABLE OtpMonthlyRouteStopDay ADD CONSTRAINT PK_OtpMonthlyRouteStopDay
    PRIMARY KEY (service_month, route_id, stop_id, day_of_week);
GO

PRINT 'Migration 021 applied: OtpMonthlyRouteStopDay.day_of_week widened to NVARCHAR(20).';
