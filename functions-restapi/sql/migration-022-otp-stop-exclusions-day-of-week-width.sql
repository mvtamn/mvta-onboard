-- Migration 022: widen OtpStopExclusions.day_of_week.
--
-- Same bug as migration-021 (OtpMonthlyRouteStopDay.day_of_week), a second
-- table this time. CONFIRMED live 2026-08-06: approving/rejecting a
-- Review Queue candidate whose day_of_week value overflowed NVARCHAR(3)
-- hit the identical SQL error ("Data type 0xE7 has an invalid data length
-- or metadata length"), surfaced to staff as a raw "Internal server error"
-- banner that then persisted on screen across month changes (nothing
-- clears actionError on selectedMonth change). day_of_week comes straight
-- from the same Avail data as the monthly table, so the same overflow
-- applies here.

ALTER TABLE OtpStopExclusions DROP CONSTRAINT UX_OtpStopExclusions_Key;
GO

ALTER TABLE OtpStopExclusions ALTER COLUMN day_of_week NVARCHAR(20) NOT NULL;
GO

ALTER TABLE OtpStopExclusions ADD CONSTRAINT UX_OtpStopExclusions_Key
    UNIQUE (service_month, route_id, stop_id, day_of_week);
GO

PRINT 'Migration 022 applied: OtpStopExclusions.day_of_week widened to NVARCHAR(20).';
