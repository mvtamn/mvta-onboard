-- Migration 148: retire the silent no-shows raised before the false-positive
-- guards (v1.5.216, 2026-09-16), the Sep 7 burst among them.
--
-- APPLY AFTER v1.6.23 IS DEPLOYED AND ONE gtfsMissedTripsPoll HAS RUN. That
-- release re-checks every open case against its start evidence and closes the
-- ones whose bus left inside the grace as Timely service. Retire only what is
-- left, so a case the evidence can settle is settled, not set aside.
--
-- Detectors gtfs-silent-v3 (the guards) and v4 (the operating window) raised
-- everything since. Earlier versions inferred a no-show from silence with
-- nothing to tell a missed trip from a feed or schedule fault: in the week of
-- 2026-09-07 they raised 1,226 cases, when the guarded detector has raised
-- 13-31 a week. Nobody reviewed them, and they cannot be reviewed now - the
-- evidence that would decide them was never recorded. They get the treatment
-- the superseded detector's 3,518 rows got: data_quality_status
-- 'legacy_unverified', which takes them out of the queue, the counts and every
-- assessment, and keeps them read-only for audit. Their outcome stays
-- unknown, not false. The reason goes in notes, which nothing else writes on
-- an unreviewed case.
--
-- Untouched: reviewed cases, cases already closed by evidence, cancellations,
-- Spare, and everything from v3/v4.
--
-- Re-runnable: a retired row is legacy and no longer matches.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL
  THROW 50148, 'Migration 148 requires MonitoredMissedTrips (migration 011).', 1;
GO

-- What will be retired, by detector and service week, before anything changes.
SELECT ISNULL(detector_version, N'(none)') AS detector_version,
       MIN(service_date) AS first_service_date,
       MAX(service_date) AS last_service_date,
       COUNT(*) AS retiring
FROM dbo.MonitoredMissedTrips
WHERE detection_type = N'silent_no_show'
  AND ISNULL(source_system, N'gtfs') = N'gtfs'
  AND validation_status = N'unreviewed'
  AND status <> N'resolved'
  AND data_quality_status <> N'legacy_unverified'
  AND ISNULL(detector_version, N'') NOT IN (N'gtfs-silent-v3', N'gtfs-silent-v4')
GROUP BY detector_version
ORDER BY first_service_date;
GO

UPDATE dbo.MonitoredMissedTrips
SET data_quality_status = N'legacy_unverified',
    notes = N'Retired 2026-10-22 (migration 148): raised by ' + ISNULL(detector_version, N'an unversioned detector')
          + N' before the false-positive guards of 2026-09-16, and never reviewed. The evidence that would decide it was not recorded, so its outcome is unknown, not false.',
    last_checked_at = SYSUTCDATETIME()
WHERE detection_type = N'silent_no_show'
  AND ISNULL(source_system, N'gtfs') = N'gtfs'
  AND validation_status = N'unreviewed'
  AND status <> N'resolved'
  AND data_quality_status <> N'legacy_unverified'
  AND ISNULL(detector_version, N'') NOT IN (N'gtfs-silent-v3', N'gtfs-silent-v4');

SELECT @@ROWCOUNT AS retired;
GO

-- What the review queue holds afterwards.
SELECT detector_version, COUNT(*) AS still_unreviewed_and_open
FROM dbo.MonitoredMissedTrips
WHERE validation_status = N'unreviewed' AND status <> N'resolved'
  AND data_quality_status <> N'legacy_unverified'
GROUP BY detector_version
ORDER BY detector_version;
GO
