-- Migration 151: declare the OTP measurement parameters, and stamp every
-- figure with the set it was polled under (ADR 0042).
--
-- Fixed-route OTP is not computed in OnBoard. It is polled from Avail, which
-- takes the measurement standard itself as URL segments: early threshold, late
-- threshold, early outlier, late outlier, show missed stops, include outliers,
-- show detours. Those seven numbers were a compiled constant, OTP_PARAMETERS
-- in lib/availClient.ts, and on 2026-10-27 they were corrected from
-- 1/5/15/30/0/1/1 to 2/5/10/60/0/1/1 (1.6.39) after Avail confirmed MVTA's BI
-- configuration. Only the late threshold had been right.
--
-- Avail also stated MVTA's thresholds are "configurable on the backend", so
-- the standard we match can move without anyone telling us; a compiled copy
-- diverges silently by default. And nothing beside a stored figure said what
-- it was measured under, so after the correction both OTP tables held figures
-- measured two different ways with no way to tell them apart. That is not
-- transitional - it is the permanent shape of the problem.
--
-- Two things, therefore:
--
--   * OtpMeasurementParameters - an append-only register of declared sets,
--     each with an effective-from date, where the standard came from, and who
--     wrote it down. A change is a new row. Nothing updates or deletes one:
--     editing a past row would retroactively rewrite the meaning of every
--     figure polled under it.
--
--   * measurement_parameters on OtpMonthlyRouteStopDay and
--     OtpDailyRouteStopHour - the segment string the poll actually sent.
--
-- EXISTING ROWS STAY NULL, DELIBERATELY. NULL means "not recorded", never
-- "current". The stamp is a property of a poll, and which poll last touched a
-- given row is not in the database; neither is the deploy time of 1.6.39.
-- Stamping the current set onto rows polled under the old one would
-- manufacture exactly the false provenance this migration exists to prevent.
-- Both sets are seeded into the register instead, so an unstamped row's
-- standard is an inference the reader draws from the register and the row's
-- updated_at - visibly an inference, not a claim the row makes.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.OtpMonthlyRouteStopDay', 'U') IS NULL
  THROW 50151, 'Migration 151 requires OtpMonthlyRouteStopDay (migration 014).', 1;
GO

-- ---------------------------------------------------------------------------
-- The register.
--
-- `segments` is a computed column rather than a value the application writes,
-- so SQL and TypeScript cannot disagree about the order of the seven numbers -
-- which is a contract with Avail's URL, not a formatting choice.
-- measurementParameters.db.contract.test.ts round-trips a row and fails if this
-- expression and `parameterSegments` ever drift apart. Not PERSISTED: the table
-- holds a handful of rows, nothing indexes the string, and computing it on read
-- means one less thing that can refuse the migration.
--
-- No unique constraint on (effective_from): the same standard can legitimately
-- be re-declared on the same day with a corrected source or note, and the
-- newest declaration wins. No unique constraint on `segments` either - a
-- standard can be changed and later changed back, and both declarations are
-- history.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.OtpMeasurementParameters', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OtpMeasurementParameters (
    id                      UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    -- The service date from which this set is the standard. A DATE, not a
    -- month: Avail's configuration changes on a day, and a month polled after
    -- that day is polled under the new set whatever its own month.
    effective_from          DATE          NOT NULL,
    early_threshold_minutes INT           NOT NULL,
    late_threshold_minutes  INT           NOT NULL,
    early_outlier_minutes   INT           NOT NULL,
    late_outlier_minutes    INT           NOT NULL,
    show_missed_stops       BIT           NOT NULL,
    include_outliers        BIT           NOT NULL,
    show_detours            BIT           NOT NULL,
    segments AS CONCAT(
      early_threshold_minutes, '/', late_threshold_minutes, '/',
      early_outlier_minutes, '/', late_outlier_minutes, '/',
      CONVERT(INT, show_missed_stops), '/', CONVERT(INT, include_outliers), '/',
      CONVERT(INT, show_detours)
    ),
    -- Where the standard came from, in the declarer's own words - "Avail
    -- confirmation 2026-10-27", not a code. There is no API that reports
    -- MVTA's BI configuration, so a declaration is always somebody writing
    -- down what Avail told them; this is what makes that auditable.
    source                  NVARCHAR(200) NOT NULL,
    notes                   NVARCHAR(1000) NULL,
    declared_by             NVARCHAR(200) NOT NULL,
    declared_at             DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_OtpMeasurementParameters_Thresholds CHECK (
      early_threshold_minutes > 0 AND early_threshold_minutes <= 60
      AND late_threshold_minutes > 0 AND late_threshold_minutes <= 60
      AND early_outlier_minutes > early_threshold_minutes
      AND late_outlier_minutes > late_threshold_minutes
      AND early_outlier_minutes <= 720 AND late_outlier_minutes <= 720
    )
  );
END
GO

-- The set in force is the newest row whose effective_from has arrived, so
-- declaring ahead of a known change is supported and the read stays one seek.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OtpMeasurementParameters_Effective'
               AND object_id = OBJECT_ID('dbo.OtpMeasurementParameters'))
  CREATE INDEX IX_OtpMeasurementParameters_Effective
    ON dbo.OtpMeasurementParameters (effective_from DESC, declared_at DESC);
GO

-- ---------------------------------------------------------------------------
-- Seed: both sets this feed has ever been polled under.
--
-- The first is NOT MVTA's standard and is recorded as such. Its outlier values
-- came from the example in Avail's own API specification, used deliberately to
-- rule out our configuration as a source of error while the feed was being
-- diagnosed, then never aligned once it had been ruled out; the thresholds
-- were believed enum-constrained, which they are not.
--
-- effective_from 2026-01-01 rather than the exact first poll: the OTP Monthly
-- feed's earliest backfilled month is January 2026, and no row anywhere
-- predates it. A date earlier than the data is honest; a date later than it
-- would leave figures the register could not explain.
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.OtpMeasurementParameters)
BEGIN
  INSERT INTO dbo.OtpMeasurementParameters (
    effective_from, early_threshold_minutes, late_threshold_minutes,
    early_outlier_minutes, late_outlier_minutes,
    show_missed_stops, include_outliers, show_detours,
    source, notes, declared_by
  ) VALUES
  ('2026-01-01', 1, 5, 15, 30, 0, 1, 1,
   'Avail API specification example - not MVTA''s standard',
   'What every figure before 2026-10-27 was polled under. The outlier values came from the example in Avail''s API specification, used to rule out our configuration as a source of error while the feed was being diagnosed; the thresholds were believed enum-constrained and are not. Recorded so stored figures can be explained, not because it was ever correct.',
   'migration-151'),
  ('2026-10-27', 2, 5, 10, 60, 0, 1, 1,
   'Avail confirmation 2026-10-27',
   'MVTA''s BI configuration as confirmed by Avail: early 2 / late 5 / early outlier 10 / late outlier 60. Include Outliers stays 1 pending Avail''s answer on whether the BI report drops outlying departures from its denominator - the likeliest explanation of 4,271 departures on route 465 against the report''s 4,045.',
   'migration-151');
END
GO

-- ---------------------------------------------------------------------------
-- The stamp.
--
-- The segment string that was sent, not a foreign key into the register: it is
-- what the request said, it reads without a join in a view or a CSV export,
-- and it has to outlive the register row - the same reason migration 141's
-- restatement ledger carries no foreign key to the figure it describes. A
-- pointer into a mutable table is not evidence.
--
-- NVARCHAR(40) leaves room for a set whose numbers grow; the current string is
-- 13 characters.
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.OtpMonthlyRouteStopDay', 'measurement_parameters') IS NULL
  ALTER TABLE dbo.OtpMonthlyRouteStopDay ADD measurement_parameters NVARCHAR(40) NULL;
GO

IF OBJECT_ID('dbo.OtpDailyRouteStopHour', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.OtpDailyRouteStopHour', 'measurement_parameters') IS NULL
  ALTER TABLE dbo.OtpDailyRouteStopHour ADD measurement_parameters NVARCHAR(40) NULL;
GO

-- A month's distinct stamps, which is what the re-pull list is read from. The
-- filtered-out case is the common one, so the index covers the grouping
-- directly rather than scanning the table per request.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OtpMonthlyRouteStopDay_Parameters'
               AND object_id = OBJECT_ID('dbo.OtpMonthlyRouteStopDay'))
  CREATE INDEX IX_OtpMonthlyRouteStopDay_Parameters
    ON dbo.OtpMonthlyRouteStopDay (service_month, measurement_parameters);
GO

-- ---------------------------------------------------------------------------
-- Reporting views. Same conventions as migrations 106 and 141: real DATE
-- columns, PascalCase names, read-only to mvta_reporting_ro.
--
-- vw_OtpMeasurementParameters publishes the register; IsInForce is computed
-- here rather than left to the reader because "which one applies today" is the
-- question every reader has, and future-dated rows make it non-obvious.
-- ---------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_OtpMeasurementParameters AS
SELECT
  p.id ParameterSetId,
  p.effective_from EffectiveFrom,
  p.segments Segments,
  p.early_threshold_minutes EarlyThresholdMinutes,
  p.late_threshold_minutes LateThresholdMinutes,
  p.early_outlier_minutes EarlyOutlierMinutes,
  p.late_outlier_minutes LateOutlierMinutes,
  CONVERT(INT, p.show_missed_stops) ShowMissedStops,
  CONVERT(INT, p.include_outliers) IncludeOutliers,
  CONVERT(INT, p.show_detours) ShowDetours,
  p.source Source,
  p.notes Notes,
  p.declared_by DeclaredBy,
  p.declared_at DeclaredAt,
  CASE WHEN p.id = (
    SELECT TOP (1) q.id FROM dbo.OtpMeasurementParameters q
    WHERE q.effective_from <= CONVERT(date, SYSUTCDATETIME())
    ORDER BY q.effective_from DESC, q.declared_at DESC
  ) THEN 1 ELSE 0 END IsInForce
FROM dbo.OtpMeasurementParameters p;
GO

-- What each service month was measured under. One row per month per distinct
-- stamp, so a month polled across a declaration shows both - which is itself
-- the finding, and the reason the count travels with it.
--
-- Whether a month needs re-pulling is deliberately NOT decided here. It
-- depends on the set in force, which depends on the clock, and the API answers
-- it from this grouping (lib/otpMeasurementParameters.ts). A view that baked
-- it in would have to be re-read to be trusted.
CREATE OR ALTER VIEW dbo.vw_OtpMeasurementProvenance AS
SELECT
  m.service_month ServiceMonth,
  CONVERT(date, CONCAT(LEFT(m.service_month, 4), '-', RIGHT(m.service_month, 2), '-01')) ServiceMonthStart,
  m.measurement_parameters Segments,
  COUNT(*) RowsUnderSet,
  MIN(m.updated_at) FirstStoredAt,
  MAX(m.updated_at) LastStoredAt
FROM dbo.OtpMonthlyRouteStopDay m
GROUP BY m.service_month, m.measurement_parameters;
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'mvta_reporting_ro')
BEGIN
  GRANT SELECT ON dbo.vw_OtpMeasurementParameters TO mvta_reporting_ro;
  GRANT SELECT ON dbo.vw_OtpMeasurementProvenance TO mvta_reporting_ro;
END
GO

PRINT 'Migration 151 applied: OtpMeasurementParameters seeded with both declared sets, measurement_parameters stamped on both OTP tables, vw_OtpMeasurementParameters + vw_OtpMeasurementProvenance published.';
GO
