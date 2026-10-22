-- Migration 149: withdraw the Dispatch Log starts that were a bus arriving at
-- its first stop, not leaving it (the readings v1.6.30 stopped writing).
--
-- APPLY AFTER v1.6.30 IS DEPLOYED (it was on dev 2026-10-22 14:00 UTC), or the
-- trip-start poll keeps writing new ones for today's rows.
--
-- As a bus pulls into its origin station, MVTA's TripUpdate feed gives the
-- arrival instant as the first stop's departure for one delivery, then goes
-- back to a prediction. Before v1.6.30 the poll kept that reading for good
-- unless the real departure arrived within 15 minutes of it, so the stuck rows
-- sit 5-15 minutes early (mostly -880 to -900 s) and count as on time. Their
-- real departure is no longer in the feed, so they become what the poll would
-- write today: no actual, status 'unknown', the last prediction kept.
--
-- Not every early reading is the glitch. Where the bus reported past its
-- second stop BEFORE the scheduled start, it really did leave early, and that
-- reading stays. Measured on dev for 2026-09-21..10-22: of 2,342 trip_update
-- readings 5+ minutes early, 72 have stop-two evidence before the schedule
-- (68 of them 5-14 minutes early); the other 2,270 are withdrawn. To withdraw
-- every 5+ minute early reading regardless, delete the NOT EXISTS clause in
-- both the preview and the UPDATE.
--
-- Untouched: vehicle_position actuals (route 495's ~23-hour-early rows come
-- from vehicle evidence dated to the wrong service day, a separate fault in
-- gtfsVehiclePositionsPoll), late starts, and anything the poll wrote after
-- the fix was deployed.
--
-- Each withdrawn reading is copied to TripStartLogWithdrawnReadings first, so
-- the change can be audited or reversed. Re-runnable: a withdrawn row has no
-- actual and no longer matches.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.TripStartLog', 'U') IS NULL OR COL_LENGTH('dbo.TripStartLog', 'actuals_updated_at') IS NULL
  THROW 50149, 'Migration 149 requires TripStartLog with migration 095 applied.', 1;
IF OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NULL
  THROW 50149, 'Migration 149 requires GtfsTripOperationalEvidence (migration 027).', 1;
GO

IF OBJECT_ID('dbo.TripStartLogWithdrawnReadings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TripStartLogWithdrawnReadings (
    service_date         CHAR(8)        NOT NULL,
    trip_id              NVARCHAR(100)  NOT NULL,
    scheduled_start_at   DATETIME2      NOT NULL,
    actual_start_at      DATETIME2      NOT NULL,
    actual_start_source  NVARCHAR(20)   NOT NULL,
    start_delay_seconds  INT            NOT NULL,
    start_status         NVARCHAR(20)   NULL,
    actuals_updated_at   DATETIME2      NULL,
    reason               NVARCHAR(200)  NOT NULL,
    withdrawn_at         DATETIME2      NOT NULL CONSTRAINT DF_TripStartLogWithdrawnReadings_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_TripStartLogWithdrawnReadings PRIMARY KEY (service_date, trip_id)
  );
END
GO

-- What will be withdrawn, by week, before anything changes.
SELECT MIN(l.service_date) AS week_from, MAX(l.service_date) AS week_to,
       COUNT(*) AS withdrawing,
       MIN(l.start_delay_seconds) AS earliest_seconds, MAX(l.start_delay_seconds) AS latest_seconds
FROM dbo.TripStartLog l
WHERE l.service_date BETWEEN '20260921' AND '20261022'
  AND l.actual_start_source = N'trip_update'
  AND l.start_delay_seconds <= -300
  AND l.actuals_updated_at < '2026-10-22T14:00:00'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.GtfsTripOperationalEvidence ev
    WHERE ev.trip_id = l.trip_id AND ev.service_date = CAST(l.service_date AS NVARCHAR(20))
      AND ev.first_underway_at < l.scheduled_start_at
  )
GROUP BY DATEDIFF(DAY, '20260921', CAST(l.service_date AS DATE)) / 7
ORDER BY week_from;
GO

BEGIN TRANSACTION;

INSERT INTO dbo.TripStartLogWithdrawnReadings
  (service_date, trip_id, scheduled_start_at, actual_start_at, actual_start_source,
   start_delay_seconds, start_status, actuals_updated_at, reason)
SELECT l.service_date, l.trip_id, l.scheduled_start_at, l.actual_start_at, l.actual_start_source,
       l.start_delay_seconds, l.start_status, l.actuals_updated_at,
       N'Migration 149: first-stop arrival reported as departure (fixed in v1.6.30)'
FROM dbo.TripStartLog l
WHERE l.service_date BETWEEN '20260921' AND '20261022'
  AND l.actual_start_source = N'trip_update'
  AND l.start_delay_seconds <= -300
  AND l.actuals_updated_at < '2026-10-22T14:00:00'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.GtfsTripOperationalEvidence ev
    WHERE ev.trip_id = l.trip_id AND ev.service_date = CAST(l.service_date AS NVARCHAR(20))
      AND ev.first_underway_at < l.scheduled_start_at
  )
  AND NOT EXISTS (
    SELECT 1 FROM dbo.TripStartLogWithdrawnReadings w
    WHERE w.service_date = l.service_date AND w.trip_id = l.trip_id
  );

UPDATE l
SET actual_start_at = NULL,
    actual_start_source = NULL,
    start_delay_seconds = NULL,
    start_status = N'unknown',
    actuals_updated_at = SYSUTCDATETIME(),
    updated_at = SYSUTCDATETIME()
FROM dbo.TripStartLog l
JOIN dbo.TripStartLogWithdrawnReadings w
  ON w.service_date = l.service_date AND w.trip_id = l.trip_id
WHERE l.actual_start_at = w.actual_start_at
  AND l.actual_start_source = N'trip_update';

SELECT @@ROWCOUNT AS withdrawn;

COMMIT TRANSACTION;
GO

-- What is left 5+ minutes early in the range: the confirmed early departures.
SELECT actual_start_source, COUNT(*) AS still_early
FROM dbo.TripStartLog
WHERE service_date BETWEEN '20260921' AND '20261022'
  AND start_delay_seconds <= -300
GROUP BY actual_start_source;
GO
