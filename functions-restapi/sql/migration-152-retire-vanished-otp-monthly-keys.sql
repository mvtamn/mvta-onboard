-- Migration 152: retire the OTP monthly keys Avail has stopped returning, and
-- give the re-pull list a way to ever reach empty (ADR 0043).
--
-- The monthly upsert has only ever inserted and updated. A key Avail stops
-- returning for a month it still publishes is left exactly as it was, because
-- a MERGE has nothing to say about a row its source did not mention. Harmless
-- while rows only ever gained figures - and then migration 151 made a row's
-- measurement_parameters mean "the standard this figure was polled under", at
-- which point a row no poll can reach became a row no poll can ever stamp.
--
-- Found on dev 2026-10-30, after all ten months had been re-pulled under the
-- declared set: 11 rows across 2026-05 (8), 2026-08 (2) and 2026-09 (1) still
-- carried no stamp, every one of them a route/stop/day-of-week Avail no longer
-- returns - 2026-09's being route 499 at Shakopee Walmart on Thursdays, 17
-- departures. ADR 0042's re-pull list counts an unstamped row as "not measured
-- under the set in force", which it is, so those three months would have sat
-- on the list for good with a Re-pull button that could never clear them. A
-- list that cannot reach empty stops being read, which is the one thing it was
-- built not to be.
--
-- Their effect on the figures is small and real both: 67 departures in 2026-05
-- (87.560% with them, 87.574% without), 2 in 2026-08, 17 in 2026-09. The
-- figures are not why this matters; the list is.
--
-- Two things, therefore:
--
--   * OtpMonthlyRetiredKeys - an append-only archive. A retired row is copied
--     here whole, with its stamp, its first_seen_at and its updated_at intact,
--     plus why it was retired and by what. Nothing updates or deletes a row
--     here.
--
--   * The one-off repair below, for the 11 rows already stranded. A row is
--     stranded when it carries NO stamp in a month that has stamped rows: the
--     month was re-polled, and this key was not in what came back. A month
--     with no stamped rows at all has simply not been re-polled since 151, and
--     is left alone.
--
-- RETIRED MEANS REMOVED FROM THE LIVE TABLE, NOT MARKED. Eleven queries in ten
-- places read OtpMonthlyRouteStopDay - the month module, the OTP month
-- endpoint, the flagged-stop rule, route classification, the date-exclusion
-- snapshot, the provenance read, and the reporting views of migrations 106,
-- 140, 141 and 151 - and a flag that one of them forgot would be a figure that
-- disagrees with itself depending on which query asked. Deleting the row cannot be half-applied. The archive is where
-- the row still exists, and it is the evidence that it was ever there.
--
-- Self-healing: if Avail sends the key again, the upsert inserts it again, as a
-- fresh row with the standard that poll used. The archive keeps the earlier
-- life either way, so a key that comes and goes leaves a legible history
-- rather than a row that silently changed meaning.
--
-- Untouched: every stamped row, every row in a month that has not been
-- re-polled since migration 151, the daily table (OtpDailyRouteStopHour keys
-- on a date and an hour, and the re-pull list does not read it), and
-- OtpMonthlyRestatements, whose ledger rows deliberately outlive the figures
-- they describe (migration 141) and so are left pointing at retired keys on
-- purpose.
--
-- Re-runnable: a retired row is gone from the live table and no longer
-- matches; the archive's primary key refuses a second copy of the same
-- retirement.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.OtpMonthlyRouteStopDay', 'U') IS NULL
  THROW 50152, 'Migration 152 requires OtpMonthlyRouteStopDay (migration 014).', 1;
GO

IF COL_LENGTH('dbo.OtpMonthlyRouteStopDay', 'measurement_parameters') IS NULL
  THROW 50152, 'Migration 152 requires the measurement_parameters stamp (migration 151).', 1;
GO

-- ---------------------------------------------------------------------------
-- The archive
-- ---------------------------------------------------------------------------
--
-- No foreign key to anything, for migration 141's reason: this row has to
-- outlive the row it is a copy of, and the whole point is that the live row is
-- gone. retired_at is part of the key so a key that is retired, returns and is
-- retired again keeps both lives.
IF OBJECT_ID('dbo.OtpMonthlyRetiredKeys', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OtpMonthlyRetiredKeys (
    service_month           CHAR(6)        NOT NULL,
    route_id                INT            NOT NULL,
    stop_id                 INT            NOT NULL,
    day_of_week             NVARCHAR(20)   NOT NULL,
    stop_name               NVARCHAR(200)  NULL,
    route_label             NVARCHAR(100)  NULL,
    pct_early               FLOAT          NULL,
    pct_ontime              FLOAT          NULL,
    pct_late                FLOAT          NULL,
    pct_not_ontime          FLOAT          NULL,
    pct_missed              FLOAT          NULL,
    early                   INT            NULL,
    ontime                  INT            NULL,
    late                    INT            NULL,
    missed                  INT            NULL,
    actual_departures       INT            NULL,
    total                   INT            NULL,
    -- The row's own history, carried across rather than restarted: when the
    -- key was first seen, when its figure last moved, and what it was measured
    -- under. A NULL stamp here is the finding, not a gap.
    first_seen_at           DATETIME2      NULL,
    updated_at              DATETIME2      NULL,
    measurement_parameters  NVARCHAR(40)   NULL,
    retired_at              DATETIME2      NOT NULL CONSTRAINT DF_OtpMonthlyRetiredKeys_RetiredAt DEFAULT SYSUTCDATETIME(),
    -- Why, in words, because a count of retired rows explains nothing a year
    -- later. Written by whatever did the retiring: this migration, or the poll
    -- that found the key absent from a month it otherwise covered.
    retired_reason          NVARCHAR(400)  NOT NULL,
    retired_by              NVARCHAR(200)  NOT NULL,
    CONSTRAINT PK_OtpMonthlyRetiredKeys PRIMARY KEY
      (service_month, route_id, stop_id, day_of_week, retired_at)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OtpMonthlyRetiredKeys_Month'
               AND object_id = OBJECT_ID('dbo.OtpMonthlyRetiredKeys'))
  CREATE INDEX IX_OtpMonthlyRetiredKeys_Month
    ON dbo.OtpMonthlyRetiredKeys (service_month, retired_at DESC);
GO

-- ---------------------------------------------------------------------------
-- The one-off repair: rows stranded by the 2026-10-29 re-pulls
-- ---------------------------------------------------------------------------

-- What will be retired, before anything changes.
SELECT m.service_month,
       m.route_id,
       m.stop_id,
       m.day_of_week,
       m.stop_name,
       m.total,
       m.ontime,
       m.updated_at
FROM dbo.OtpMonthlyRouteStopDay m
WHERE m.measurement_parameters IS NULL
  AND EXISTS (
    SELECT 1 FROM dbo.OtpMonthlyRouteStopDay s
    WHERE s.service_month = m.service_month
      AND s.measurement_parameters IS NOT NULL
  )
ORDER BY m.service_month DESC, m.route_id, m.stop_id;
GO

-- One transaction, and the DELETE's own OUTPUT decides what is archived: the
-- archive is written from the rows that were actually removed, not from a
-- second evaluation of the predicate.
--
-- Note the clause order. In a DELETE that names its target by alias, OUTPUT
-- comes between the target and the FROM clause - DELETE m / OUTPUT ... / FROM
-- ... / WHERE ... - and an OUTPUT written after the WHERE is a syntax error
-- ("Incorrect syntax near 'OUTPUT'"), which is what CI reported the first time
-- this migration ran. XACT_ABORT with the explicit transaction closes the
-- window where a row could be deleted but not archived.
-- XACT_ABORT is set inside this batch, not in one of its own: a batch may be
-- run on a different pooled connection than the one before it, and a session
-- setting left in another batch would simply not apply here.
SET XACT_ABORT ON;

DECLARE @stranded TABLE (
  service_month CHAR(6), route_id INT, stop_id INT, day_of_week NVARCHAR(20),
  stop_name NVARCHAR(200), route_label NVARCHAR(100),
  pct_early FLOAT, pct_ontime FLOAT, pct_late FLOAT, pct_not_ontime FLOAT, pct_missed FLOAT,
  early INT, ontime INT, late INT, missed INT, actual_departures INT, total INT,
  first_seen_at DATETIME2, updated_at DATETIME2, measurement_parameters NVARCHAR(40)
);

BEGIN TRANSACTION;

DELETE m
OUTPUT deleted.service_month, deleted.route_id, deleted.stop_id, deleted.day_of_week,
       deleted.stop_name, deleted.route_label,
       deleted.pct_early, deleted.pct_ontime, deleted.pct_late,
       deleted.pct_not_ontime, deleted.pct_missed,
       deleted.early, deleted.ontime, deleted.late, deleted.missed,
       deleted.actual_departures, deleted.total,
       deleted.first_seen_at, deleted.updated_at, deleted.measurement_parameters
INTO @stranded
FROM dbo.OtpMonthlyRouteStopDay m
WHERE m.measurement_parameters IS NULL
  AND EXISTS (
    SELECT 1 FROM dbo.OtpMonthlyRouteStopDay s
    WHERE s.service_month = m.service_month
      AND s.measurement_parameters IS NOT NULL
  );

INSERT INTO dbo.OtpMonthlyRetiredKeys (
  service_month, route_id, stop_id, day_of_week, stop_name, route_label,
  pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
  early, ontime, late, missed, actual_departures, total,
  first_seen_at, updated_at, measurement_parameters, retired_reason, retired_by
)
SELECT service_month, route_id, stop_id, day_of_week, stop_name, route_label,
       pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
       early, ontime, late, missed, actual_departures, total,
       first_seen_at, updated_at, measurement_parameters,
       N'Retired 2026-10-30 (migration 152): the month was re-polled under the declared measurement standard and Avail did not return this route/stop/day of week, so no poll can reach it and nothing can ever stamp it.',
       N'migration-152'
FROM @stranded;

COMMIT TRANSACTION;
GO

-- ---------------------------------------------------------------------------
-- Reporting view. Conventions of migrations 106, 141 and 151: real DATE
-- columns, PascalCase names, read-only to mvta_reporting_ro.
--
-- Published because a figure that moved because a key left the table is a
-- figure somebody will ask about, and this is the only place that answers it.
-- ---------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_OtpMonthlyRetiredKeys AS
SELECT
  r.service_month ServiceMonth,
  CONVERT(date, CONCAT(LEFT(r.service_month, 4), '-', RIGHT(r.service_month, 2), '-01')) ServiceMonthStart,
  r.route_id RouteId,
  r.route_label RouteLabel,
  r.stop_id StopId,
  r.stop_name StopName,
  r.day_of_week DayOfWeek,
  r.total TotalDepartures,
  r.ontime OnTimeDepartures,
  r.pct_ontime PercentOnTime,
  r.measurement_parameters MeasuredUnder,
  r.first_seen_at FirstSeenAt,
  r.updated_at LastFigureAt,
  r.retired_at RetiredAt,
  r.retired_reason RetiredReason,
  r.retired_by RetiredBy
FROM dbo.OtpMonthlyRetiredKeys r;
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mvta_reporting_ro')
BEGIN
  GRANT SELECT ON dbo.vw_OtpMonthlyRetiredKeys TO mvta_reporting_ro;
END
GO

PRINT 'Migration 152 applied: OtpMonthlyRetiredKeys created, stranded unstamped keys archived and removed from OtpMonthlyRouteStopDay, vw_OtpMonthlyRetiredKeys published.';
GO
