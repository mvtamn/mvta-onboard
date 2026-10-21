-- Migration 147: the nightly prediction accuracy score (ADR 0041,
-- plans/prediction-accuracy-evaluation.md increment 2).
--
-- The 30-second capture writes raw predictions and vehicle positions to Blob
-- storage (v1.5.332). The nightly scorer, predictionScore, reads one service
-- day back, works out when each bus actually reached each stop, scores every
-- prediction with the ETA Accuracy Benchmark and keeps only the tallies here.
-- Tallies, not percentages, so any period and any grouping can be scored by
-- adding them up; the agency figure is the benchmark over everyone's tallies,
-- never an average of routes.
--
--   PredictionAccuracyDays        one row per scored service day: what was read
--                                 and why each prediction left out was left out
--   PredictionAccuracyRouteHours  per route, direction, hour and bucket
--   PredictionAccuracyStops       per route, stop and bucket, for the drill-down
--
-- A rescore of a day replaces all three for that day. Expect a few thousand
-- rows a day. Until this is applied the scorer says so once a night and
-- stores nothing; the capture keeps writing and nothing is lost for 90 days.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.PredictionAccuracyDays', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PredictionAccuracyDays (
    service_date CHAR(8) NOT NULL CONSTRAINT PK_PredictionAccuracyDays PRIMARY KEY,
    scored_at DATETIME2 NOT NULL,
    capture_runs INT NOT NULL,
    stale_runs INT NOT NULL,
    samples INT NOT NULL,
    duplicate_samples INT NOT NULL,
    stale_samples INT NOT NULL,
    passed_samples INT NOT NULL,
    out_of_range INT NOT NULL,
    no_vehicle INT NOT NULL,
    no_actual_unseen INT NOT NULL,
    no_actual_not_reached INT NOT NULL,
    no_actual_gap INT NOT NULL,
    indeterminate INT NOT NULL,
    scored INT NOT NULL,
    actuals INT NOT NULL,
    cross_check_compared INT NOT NULL,
    cross_check_agreed INT NOT NULL,
    cross_check_median_offset_seconds INT NULL,
    unreadable_lines INT NOT NULL
  );
END
GO

IF OBJECT_ID('dbo.PredictionAccuracyRouteHours', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PredictionAccuracyRouteHours (
    service_date CHAR(8) NOT NULL,
    route_id NVARCHAR(50) NOT NULL,
    direction_id TINYINT NULL,
    hour_of_day TINYINT NOT NULL,
    bucket VARCHAR(5) NOT NULL,
    predictions INT NOT NULL,
    accurate INT NOT NULL,
    early INT NOT NULL,
    late INT NOT NULL,
    indeterminate INT NOT NULL
  );
  CREATE CLUSTERED INDEX CX_PredictionAccuracyRouteHours ON dbo.PredictionAccuracyRouteHours (service_date, route_id);
END
GO

IF OBJECT_ID('dbo.PredictionAccuracyStops', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PredictionAccuracyStops (
    service_date CHAR(8) NOT NULL,
    route_id NVARCHAR(50) NOT NULL,
    stop_id NVARCHAR(50) NOT NULL,
    bucket VARCHAR(5) NOT NULL,
    predictions INT NOT NULL,
    accurate INT NOT NULL,
    early INT NOT NULL,
    late INT NOT NULL,
    indeterminate INT NOT NULL
  );
  CREATE CLUSTERED INDEX CX_PredictionAccuracyStops ON dbo.PredictionAccuracyStops (service_date, route_id, stop_id);
END
GO

PRINT 'Migration 147 applied: prediction accuracy daily tallies.';
GO
