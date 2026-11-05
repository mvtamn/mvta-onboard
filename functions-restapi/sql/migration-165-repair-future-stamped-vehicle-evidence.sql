-- Migration 165: take the hour off vehicle evidence stamped by AVL clocks
-- still on CDT after daylight saving ended (2026-11-01).
--
-- APPLY AFTER v1.7.45 IS DEPLOYED. Re-runnable: a repaired row no longer
-- matches, and every row is copied to the audit table before it changes.
--
-- gtfsVehiclePositionsPoll stored each position's own timestamp as the time
-- it was observed. From 2026-11-01, some units stamped positions an hour
-- ahead, so first_underway_at read an hour late and the missed-trip detector
-- escalated buses that left on time. v1.7.45 records such a position at the
-- fetch time instead (vehicleObservedAt); this repairs the rows written before.
--
-- How a row is recognised: updated_at is the poller's own write time, set in
-- the same statement as last_vehicle_position_at, so a position stamped after
-- the write that stored it is impossible unless the bus's clock was wrong.
-- Measured on dev 2026-11-04, 436 rows were 30-60 minutes ahead (2,386-3,593 s,
-- never more than an hour): 172 on 11-01, 238 on 11-02, 26 on 11-03, none
-- before or since. Their first_underway_at ran 45-90 minutes after the Dispatch
-- Log's departure; with 3,600 s taken off, 8.75 minutes on average (-17 to +47),
-- the same gap as any other day. Rows that do not match were left alone even on
-- the same vehicle and day: their gaps were already normal.
--
-- What changes, by exactly 3,600 s:
--   * GtfsTripOperationalEvidence: first_vehicle_position_at,
--     last_vehicle_position_at, first_underway_at, source_timestamp_at.
--   * MonitoredMissedTrips.detected_late_arrival_at, where it was taken from
--     the skewed first_underway_at or first_vehicle_position_at.
-- The Dispatch Log is untouched: none of its vehicle_position actuals came
-- from these rows. On dev, 20 cases point at them; the 15 still escalated and
-- unreviewed start inside their grace once repaired, and the detector's next
-- pass closes them as Timely service (openCaseStarts).

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.GtfsTripOperationalEvidence', 'U') IS NULL
  THROW 50165, 'Migration 165 requires GtfsTripOperationalEvidence (migration 027).', 1;
GO

IF OBJECT_ID('dbo.GtfsTripOperationalEvidenceClockSkew', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GtfsTripOperationalEvidenceClockSkew (
    trip_id                    NVARCHAR(100)  NOT NULL,
    service_date               NVARCHAR(20)   NOT NULL,
    vehicle_id                 NVARCHAR(100)  NULL,
    first_vehicle_position_at  DATETIME2      NULL,
    last_vehicle_position_at   DATETIME2      NULL,
    first_underway_at          DATETIME2      NULL,
    source_timestamp_at        DATETIME2      NULL,
    updated_at                 DATETIME2      NULL,
    shifted_seconds            INT            NOT NULL,
    repaired_at                DATETIME2      NOT NULL CONSTRAINT DF_GtfsTripOperationalEvidenceClockSkew_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_GtfsTripOperationalEvidenceClockSkew PRIMARY KEY (trip_id, service_date)
  );
END
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @shift INT = 3600;
DECLARE @skewed TABLE (
  trip_id NVARCHAR(100) NOT NULL, service_date NVARCHAR(20) NOT NULL,
  first_vehicle_position_at DATETIME2 NULL, first_underway_at DATETIME2 NULL,
  PRIMARY KEY (trip_id, service_date)
);

INSERT @skewed (trip_id, service_date, first_vehicle_position_at, first_underway_at)
SELECT e.trip_id, e.service_date, e.first_vehicle_position_at, e.first_underway_at
FROM dbo.GtfsTripOperationalEvidence e
WHERE e.updated_at IS NOT NULL
  AND e.last_vehicle_position_at > DATEADD(MINUTE, 30, e.updated_at)
  AND e.last_vehicle_position_at <= DATEADD(SECOND, @shift, e.updated_at)
  AND NOT EXISTS (
    SELECT 1 FROM dbo.GtfsTripOperationalEvidenceClockSkew a
    WHERE a.trip_id = e.trip_id AND a.service_date = e.service_date
  );

INSERT dbo.GtfsTripOperationalEvidenceClockSkew (
  trip_id, service_date, vehicle_id, first_vehicle_position_at, last_vehicle_position_at,
  first_underway_at, source_timestamp_at, updated_at, shifted_seconds)
SELECT e.trip_id, e.service_date, e.vehicle_id, e.first_vehicle_position_at, e.last_vehicle_position_at,
       e.first_underway_at, e.source_timestamp_at, e.updated_at, @shift
FROM dbo.GtfsTripOperationalEvidence e
JOIN @skewed s ON s.trip_id = e.trip_id AND s.service_date = e.service_date;

UPDATE e SET
  first_vehicle_position_at = DATEADD(SECOND, -@shift, e.first_vehicle_position_at),
  last_vehicle_position_at  = DATEADD(SECOND, -@shift, e.last_vehicle_position_at),
  first_underway_at         = DATEADD(SECOND, -@shift, e.first_underway_at),
  source_timestamp_at       = DATEADD(SECOND, -@shift, e.source_timestamp_at)
FROM dbo.GtfsTripOperationalEvidence e
JOIN @skewed s ON s.trip_id = e.trip_id AND s.service_date = e.service_date;

DECLARE @evidence INT = @@ROWCOUNT;
DECLARE @cases INT = 0;

IF OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NOT NULL
BEGIN
  UPDATE m SET detected_late_arrival_at = DATEADD(SECOND, -@shift, m.detected_late_arrival_at)
  FROM dbo.MonitoredMissedTrips m
  JOIN @skewed s ON s.trip_id = m.trip_id AND s.service_date = m.service_date
  WHERE m.detected_late_arrival_at = s.first_underway_at
     OR m.detected_late_arrival_at = s.first_vehicle_position_at;
  SET @cases = @@ROWCOUNT;
END

COMMIT TRANSACTION;

PRINT CONCAT('Migration 165 applied: ', @evidence, ' evidence rows and ', @cases,
             ' case arrival times moved back ', @shift, ' s.');
GO
