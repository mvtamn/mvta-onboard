-- Migration 150: undo the vehicle evidence filed under the wrong service day
-- (the fault v1.6.35 fixed in gtfsVehiclePositionsPoll).
--
-- APPLY AFTER v1.6.35 IS DEPLOYED, or tonight's route 495 run writes a new one.
--
-- MVTA's VehiclePosition feed often sends a trip without a start_date, and
-- the poller dated that evidence from the observation. Route 495's 22:30-23:02
-- trips are still reporting after midnight, so their 00:0x reports opened a
-- GtfsTripOperationalEvidence row under the NEXT service date, with a
-- first_vehicle_position_at and first_underway_at about 23 hours before that
-- day's own run. Both columns are sticky, so the next day's real run never
-- replaced them, and the Dispatch Log's vehicle-position fallback wrote them
-- as that run's start.
--
-- Measured on dev 2026-10-22 (the scheduled start is TripStartLog's, else the
-- static schedule's): 47 evidence rows have first_underway_at 6+ hours before
-- the scheduled start, all route 495, 2026-09-06..10-22, 22.4-23 hours early.
-- None has a first_trip_update_at; 27 had their own run report later that
-- day. 28 TripStartLog rows carry one as a vehicle_position actual. No
-- MonitoredMissedTrips row points at any of them. 11,794 older evidence rows
-- have no scheduled start to compare with (trip ids no longer in the schedule
-- and before the Dispatch Log) and cannot be checked.
--
-- What changes:
--   * A row holding nothing but the previous night's reports (no TripUpdate,
--     last vehicle report also 6+ hours early) is deleted: it is not evidence
--     of that day's run at all.
--   * A row whose own run also reported keeps those reports; its
--     first_vehicle_position_at and first_underway_at are cleared, because the
--     real values were never recorded and cannot be recovered.
--   * The Dispatch Log's vehicle_position actuals 6+ hours early are withdrawn
--     to 'unknown', as migration 149 did for the arrival readings.
--
-- Every evidence row is copied to GtfsTripOperationalEvidenceMisdated and
-- every withdrawn start to TripStartLogWithdrawnReadings first, so the change
-- can be audited or reversed. Re-runnable: a repaired row no longer matches.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NULL
  THROW 50150, 'Migration 150 requires GtfsTripOperationalEvidence (migration 027).', 1;
IF OBJECT_ID('dbo.TripStartLogWithdrawnReadings', 'U') IS NULL
  THROW 50150, 'Migration 150 requires TripStartLogWithdrawnReadings (migration 149).', 1;
GO

IF OBJECT_ID('dbo.GtfsTripOperationalEvidenceMisdated', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GtfsTripOperationalEvidenceMisdated (
    trip_id                    NVARCHAR(100)  NOT NULL,
    service_date               NVARCHAR(20)   NOT NULL,
    route_id                   NVARCHAR(50)   NULL,
    vehicle_id                 NVARCHAR(100)  NULL,
    first_trip_update_at       DATETIME2      NULL,
    last_trip_update_at        DATETIME2      NULL,
    first_vehicle_position_at  DATETIME2      NULL,
    last_vehicle_position_at   DATETIME2      NULL,
    first_underway_at          DATETIME2      NULL,
    scheduled_start_at         DATETIME2      NOT NULL,
    action                     NVARCHAR(20)   NOT NULL, -- 'deleted' or 'cleared'
    reason                     NVARCHAR(200)  NOT NULL,
    repaired_at                DATETIME2      NOT NULL CONSTRAINT DF_GtfsTripOperationalEvidenceMisdated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_GtfsTripOperationalEvidenceMisdated PRIMARY KEY (trip_id, service_date)
  );
END
GO

-- The scheduled start of each evidence row's own run: the Dispatch Log's when
-- it has a row, else the static schedule's first departure on that date.
CREATE OR ALTER VIEW dbo.vw_Migration150Misdated AS
WITH reference AS (
  SELECT e.trip_id, e.service_date, e.route_id, e.vehicle_id,
         e.first_trip_update_at, e.last_trip_update_at,
         e.first_vehicle_position_at, e.last_vehicle_position_at, e.first_underway_at,
         COALESCE(
           dl.scheduled_start_at,
           CAST(DATEADD(SECOND, st.first_departure_seconds, CAST(CONVERT(DATE, e.service_date, 112) AS DATETIME2))
                AT TIME ZONE 'Central Standard Time' AT TIME ZONE 'UTC' AS DATETIME2)
         ) AS scheduled_start_at
  FROM dbo.GtfsTripOperationalEvidence e
  LEFT JOIN dbo.GtfsScheduledTrips st ON st.trip_id = e.trip_id
  LEFT JOIN dbo.TripStartLog dl
    ON dl.trip_id = e.trip_id AND CAST(dl.service_date AS NVARCHAR(20)) = e.service_date
)
SELECT r.*,
       CASE WHEN r.first_trip_update_at IS NULL AND r.last_trip_update_at IS NULL
                 AND r.last_vehicle_position_at < DATEADD(HOUR, -6, r.scheduled_start_at)
            THEN N'deleted' ELSE N'cleared' END AS action
FROM reference r
WHERE r.first_underway_at < DATEADD(HOUR, -6, r.scheduled_start_at)
   OR r.first_vehicle_position_at < DATEADD(HOUR, -6, r.scheduled_start_at);
GO

-- What will change, before anything does.
SELECT action, COUNT(*) AS evidence_rows, MIN(service_date) AS from_date, MAX(service_date) AS to_date,
       MIN(DATEDIFF(MINUTE, first_vehicle_position_at, scheduled_start_at)) AS min_minutes_early,
       MAX(DATEDIFF(MINUTE, first_vehicle_position_at, scheduled_start_at)) AS max_minutes_early
FROM dbo.vw_Migration150Misdated
GROUP BY action;

SELECT COUNT(*) AS dispatch_log_withdrawing
FROM dbo.TripStartLog
WHERE actual_start_source = N'vehicle_position' AND start_delay_seconds <= -21600;
GO

BEGIN TRANSACTION;

INSERT INTO dbo.GtfsTripOperationalEvidenceMisdated
  (trip_id, service_date, route_id, vehicle_id, first_trip_update_at, last_trip_update_at,
   first_vehicle_position_at, last_vehicle_position_at, first_underway_at, scheduled_start_at, action, reason)
SELECT m.trip_id, m.service_date, m.route_id, m.vehicle_id, m.first_trip_update_at, m.last_trip_update_at,
       m.first_vehicle_position_at, m.last_vehicle_position_at, m.first_underway_at, m.scheduled_start_at, m.action,
       N'Migration 150: previous night''s vehicle reports filed under the next service date (fixed in v1.6.35)'
FROM dbo.vw_Migration150Misdated m
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.GtfsTripOperationalEvidenceMisdated x
  WHERE x.trip_id = m.trip_id AND x.service_date = m.service_date
);

DELETE e
FROM dbo.GtfsTripOperationalEvidence e
JOIN dbo.GtfsTripOperationalEvidenceMisdated x
  ON x.trip_id = e.trip_id AND x.service_date = e.service_date AND x.action = N'deleted'
WHERE (e.first_vehicle_position_at = x.first_vehicle_position_at OR e.first_underway_at = x.first_underway_at);
SELECT @@ROWCOUNT AS evidence_deleted;

UPDATE e
SET first_vehicle_position_at = NULL,
    first_underway_at = NULL,
    updated_at = SYSUTCDATETIME()
FROM dbo.GtfsTripOperationalEvidence e
JOIN dbo.GtfsTripOperationalEvidenceMisdated x
  ON x.trip_id = e.trip_id AND x.service_date = e.service_date AND x.action = N'cleared'
WHERE (e.first_vehicle_position_at = x.first_vehicle_position_at OR e.first_underway_at = x.first_underway_at);
SELECT @@ROWCOUNT AS evidence_cleared;

INSERT INTO dbo.TripStartLogWithdrawnReadings
  (service_date, trip_id, scheduled_start_at, actual_start_at, actual_start_source,
   start_delay_seconds, start_status, actuals_updated_at, reason)
SELECT l.service_date, l.trip_id, l.scheduled_start_at, l.actual_start_at, l.actual_start_source,
       l.start_delay_seconds, l.start_status, l.actuals_updated_at,
       N'Migration 150: vehicle evidence from the previous night (fixed in v1.6.35)'
FROM dbo.TripStartLog l
WHERE l.actual_start_source = N'vehicle_position'
  AND l.start_delay_seconds <= -21600
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
  AND l.actual_start_source = N'vehicle_position'
  AND w.actual_start_source = N'vehicle_position';
SELECT @@ROWCOUNT AS dispatch_log_withdrawn;

COMMIT TRANSACTION;
GO

DROP VIEW dbo.vw_Migration150Misdated;
GO

-- Nothing should be left 6+ hours early.
SELECT
  (SELECT COUNT(*) FROM dbo.TripStartLog
   WHERE actual_start_source = N'vehicle_position' AND start_delay_seconds <= -21600) AS dispatch_log_still_early;
GO
