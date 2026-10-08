-- Migration 125: the Missed-trip case module's review outcomes, operating
-- window, and reporting view (increment 2; 123 and 124 were taken by other changes).
--
-- 1. Four Missed-trip review outcomes (CONTEXT.md): Confirmed missed trip
--    ('confirmed'), Timely service, Partial-service failure and Indeterminate.
--    The status columns widen from NVARCHAR(20) to NVARCHAR(30) to hold them.
--    'false_positive' meant "not a missed trip", which is Timely service, so
--    existing rows are rewritten to 'timely_service'; their review history rows
--    get a note saying so. The CHECK constraints still admit 'false_positive',
--    so the running code keeps working until the new code is deployed.
-- 2. MissedTripReviewHistory.review_kind ('review', 'supersede',
--    'legacy_rereview') and review_reason: a Superseding missed-trip review and
--    a legacy rereview say why. Existing rows are 'review'.
-- 3. GtfsScheduledTrips.last_arrival_seconds: the final stop's scheduled
--    arrival, filled by the next static GTFS sync.
-- 4. MonitoredMissedTrips.expected_window_end_at: the end of a silent no-show's
--    Expected operating window (final stop + 30 minutes), stamped when the case
--    opens. Cases from detector gtfs-silent-v4 stay Awaiting evidence until it
--    has passed - and while it is unknown.
-- 5. vw_MissedTrip keeps every column it had and adds the module's
--    classification. The CROSS APPLY below is missedTripCaseSql("m", "mtc",
--    no promoted detectors) verbatim - migration125.db.contract.test.ts fails if
--    the two drift - so the view reports every detector as in Shadow detection
--    (CountsTowardAssessment = 0); promotion is an app setting SQL cannot read.
--
-- Re-runnable: columns and constraints are added only when missing or narrower,
-- the rewrites find nothing on a second pass, and the view is CREATE OR ALTER.
-- Apply it before deploying the code that writes the new outcomes and columns.
--
-- Rows written here carry the note text "migration 125" (see sql/README.md).

IF OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL OR OBJECT_ID('dbo.MissedTripReviewHistory', 'U') IS NULL
  THROW 50125, 'Migration 125 requires MonitoredMissedTrips and MissedTripReviewHistory (migrations 011 and 026).', 1;
GO

IF OBJECT_ID('dbo.GtfsScheduledTrips', 'U') IS NOT NULL AND COL_LENGTH('dbo.GtfsScheduledTrips', 'last_arrival_seconds') IS NULL
  ALTER TABLE dbo.GtfsScheduledTrips ADD last_arrival_seconds INT NULL;
IF COL_LENGTH('dbo.MonitoredMissedTrips', 'expected_window_end_at') IS NULL
  ALTER TABLE dbo.MonitoredMissedTrips ADD expected_window_end_at DATETIME2 NULL;
IF COL_LENGTH('dbo.MissedTripReviewHistory', 'review_kind') IS NULL
  ALTER TABLE dbo.MissedTripReviewHistory ADD review_kind NVARCHAR(20) NULL;
IF COL_LENGTH('dbo.MissedTripReviewHistory', 'review_reason') IS NULL
  ALTER TABLE dbo.MissedTripReviewHistory ADD review_reason NVARCHAR(1000) NULL;
GO

-- 'partial_service_failure' is 23 characters and the status columns are
-- NVARCHAR(20). A column cannot be widened while a CHECK or DEFAULT depends on
-- it, so those are dropped here and put back after.
IF COL_LENGTH('dbo.MonitoredMissedTrips', 'validation_status') < 60
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MonitoredMissedTrips_ValidationStatus' AND parent_object_id = OBJECT_ID('dbo.MonitoredMissedTrips'))
    ALTER TABLE dbo.MonitoredMissedTrips DROP CONSTRAINT CK_MonitoredMissedTrips_ValidationStatus;
  DECLARE @default SYSNAME = (
    SELECT dc.name FROM sys.default_constraints dc
    WHERE dc.parent_object_id = OBJECT_ID('dbo.MonitoredMissedTrips')
      AND dc.parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.MonitoredMissedTrips'), 'validation_status', 'ColumnId'));
  DECLARE @drop_default NVARCHAR(400) = N'ALTER TABLE dbo.MonitoredMissedTrips DROP CONSTRAINT ' + QUOTENAME(@default);
  IF @default IS NOT NULL EXEC sp_executesql @drop_default;
  ALTER TABLE dbo.MonitoredMissedTrips ALTER COLUMN validation_status NVARCHAR(30) NOT NULL;
  ALTER TABLE dbo.MonitoredMissedTrips ADD CONSTRAINT DF_MonitoredMissedTrips_ValidationStatus DEFAULT 'unreviewed' FOR validation_status;
END;
IF COL_LENGTH('dbo.MissedTripReviewHistory', 'validation_status') < 60
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MissedTripReviewHistory_Status' AND parent_object_id = OBJECT_ID('dbo.MissedTripReviewHistory'))
    ALTER TABLE dbo.MissedTripReviewHistory DROP CONSTRAINT CK_MissedTripReviewHistory_Status;
  ALTER TABLE dbo.MissedTripReviewHistory ALTER COLUMN validation_status NVARCHAR(30) NOT NULL;
END;
IF COL_LENGTH('dbo.MissedTripReviewHistory', 'previous_validation_status') < 60
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MissedTripReviewHistory_PreviousStatus' AND parent_object_id = OBJECT_ID('dbo.MissedTripReviewHistory'))
    ALTER TABLE dbo.MissedTripReviewHistory DROP CONSTRAINT CK_MissedTripReviewHistory_PreviousStatus;
  ALTER TABLE dbo.MissedTripReviewHistory ALTER COLUMN previous_validation_status NVARCHAR(30) NOT NULL;
END;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MonitoredMissedTrips_ValidationStatus'
           AND parent_object_id = OBJECT_ID('dbo.MonitoredMissedTrips') AND definition NOT LIKE '%indeterminate%')
  ALTER TABLE dbo.MonitoredMissedTrips DROP CONSTRAINT CK_MonitoredMissedTrips_ValidationStatus;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MonitoredMissedTrips_ValidationStatus'
               AND parent_object_id = OBJECT_ID('dbo.MonitoredMissedTrips'))
  ALTER TABLE dbo.MonitoredMissedTrips ADD CONSTRAINT CK_MonitoredMissedTrips_ValidationStatus
    CHECK (validation_status IN ('unreviewed', 'confirmed', 'timely_service', 'partial_service_failure', 'indeterminate', 'false_positive'));

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MissedTripReviewHistory_Status'
           AND parent_object_id = OBJECT_ID('dbo.MissedTripReviewHistory') AND definition NOT LIKE '%indeterminate%')
  ALTER TABLE dbo.MissedTripReviewHistory DROP CONSTRAINT CK_MissedTripReviewHistory_Status;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MissedTripReviewHistory_Status'
               AND parent_object_id = OBJECT_ID('dbo.MissedTripReviewHistory'))
  ALTER TABLE dbo.MissedTripReviewHistory ADD CONSTRAINT CK_MissedTripReviewHistory_Status
    CHECK (validation_status IN ('confirmed', 'timely_service', 'partial_service_failure', 'indeterminate', 'false_positive'));

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MissedTripReviewHistory_PreviousStatus'
           AND parent_object_id = OBJECT_ID('dbo.MissedTripReviewHistory') AND definition NOT LIKE '%indeterminate%')
  ALTER TABLE dbo.MissedTripReviewHistory DROP CONSTRAINT CK_MissedTripReviewHistory_PreviousStatus;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MissedTripReviewHistory_PreviousStatus'
               AND parent_object_id = OBJECT_ID('dbo.MissedTripReviewHistory'))
  ALTER TABLE dbo.MissedTripReviewHistory ADD CONSTRAINT CK_MissedTripReviewHistory_PreviousStatus
    CHECK (previous_validation_status IN ('unreviewed', 'confirmed', 'timely_service', 'partial_service_failure', 'indeterminate', 'false_positive'));
GO

DECLARE @cases INT = (SELECT COUNT(*) FROM dbo.MonitoredMissedTrips WHERE validation_status = 'false_positive');
DECLARE @history INT = (SELECT COUNT(*) FROM dbo.MissedTripReviewHistory WHERE validation_status = 'false_positive' OR previous_validation_status = 'false_positive');
PRINT CONCAT('Migration 125 before: ', @cases, ' case(s) and ', @history, ' history row(s) name false_positive.');
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;

UPDATE dbo.MonitoredMissedTrips SET validation_status = 'timely_service' WHERE validation_status = 'false_positive';

UPDATE dbo.MissedTripReviewHistory
SET validation_status = 'timely_service',
    notes = LEFT(CONCAT(notes, CASE WHEN notes IS NULL THEN N'' ELSE N' ' END,
                        N'[Recorded as false_positive; migration 125 names this outcome Timely service.]'), 1000)
WHERE validation_status = 'false_positive';

UPDATE dbo.MissedTripReviewHistory SET previous_validation_status = 'timely_service' WHERE previous_validation_status = 'false_positive';

UPDATE dbo.MissedTripReviewHistory SET review_kind = 'review' WHERE review_kind IS NULL;

COMMIT TRANSACTION;
SET XACT_ABORT OFF;
GO

-- Migration 135 regenerates this view with the Evidence conflict columns. This
-- file is re-runnable, so without the guard a re-run would put the
-- pre-conflict definition back and Power BI would read a different rule with
-- nothing failing. Same guard migration 106 carries against this file.
IF COL_LENGTH('dbo.MonitoredMissedTrips', 'evidence_conflict_at') IS NOT NULL
  SET NOEXEC ON;
GO

CREATE OR ALTER VIEW dbo.vw_MissedTrip AS
SELECT
  m.trip_id TripId,
  m.service_date ServiceDateKey,
  TRY_CONVERT(date, LEFT(m.service_date, 8), 112) ServiceDate,
  TRY_CONVERT(date, CONCAT(LEFT(m.service_date, 4), '-', SUBSTRING(m.service_date, 5, 2), '-01')) ServiceMonthStart,
  m.route_id RouteId,
  classification.route_label RouteLabel,
  ISNULL(classification.route_category, N'FixedRoute') RouteCategory,
  ISNULL(m.source_system, N'gtfs') SourceSystem,
  CASE ISNULL(m.source_system, N'gtfs') WHEN N'spare' THEN N'on_demand' ELSE N'fixed_route' END ServiceType,
  m.source_record_id SourceRecordId,
  m.detection_type DetectionType,
  m.detector_version DetectorVersion,
  m.data_quality_status DataQualityStatus,
  CONVERT(bit, CASE WHEN m.data_quality_status = N'source_verified' THEN 1 ELSE 0 END) IsSourceVerified,
  m.status DetectionStatus,
  m.scheduled_departure_at ScheduledDepartureAt,
  m.grace_deadline_at GraceDeadlineAt,
  m.detected_late_arrival_at DetectedLateArrivalAt,
  m.expected_window_end_at ExpectedWindowEndAt,
  m.validation_status ValidationStatus,
  CONVERT(bit, CASE WHEN mtc.review_outcome = N'confirmed_missed_trip' THEN 1 ELSE 0 END) IsConfirmed,
  m.reason_code ReasonCode,
  reason.label ReasonLabel,
  m.validated_by ValidatedBy,
  m.validated_at ValidatedAt,
  occurrence.id OccurrenceId,
  occurrence.review_status OccurrenceReviewStatus,
  occurrence.attribution OccurrenceAttribution,
  CONVERT(bit, CASE WHEN occurrence.id IS NULL THEN 0 ELSE 1 END) HasOccurrence,
  CONVERT(bit, CASE WHEN occurrence.review_status = N'confirmed'
                     AND occurrence.attribution = N'contractor_error' THEN 1 ELSE 0 END) IsAssessed,
  m.first_seen_watching_at FirstSeenAt,
  m.last_checked_at LastCheckedAt,
  -- The Missed-trip case module's classification (lib/missedTripCase/classify.ts).
  mtc.lifecycle Lifecycle,
  mtc.evidence_finding EvidenceFinding,
  mtc.review_outcome ReviewOutcome,
  mtc.detector Detector,
  mtc.held_reason HeldReason,
  mtc.legacy IsLegacy,
  mtc.held IsHeld,
  mtc.in_queue InReviewQueue,
  mtc.concluded IsConcluded,
  mtc.flagged_missed IsFlaggedMissed,
  mtc.counts_as_missed CountsAsMissed,
  mtc.counts_toward_assessment CountsTowardAssessment
FROM dbo.MonitoredMissedTrips m
    CROSS APPLY (SELECT
      CASE WHEN m.data_quality_status = N'legacy_unverified' THEN 1 ELSE 0 END AS legacy,
      CASE WHEN m.validation_status <> N'unreviewed' THEN 1 ELSE 0 END AS reviewed,
      CASE WHEN m.status = N'resolved' THEN 1 ELSE 0 END AS resolved,
      CASE WHEN m.data_quality_status <> N'legacy_unverified' AND m.validation_status = N'unreviewed'
                AND m.status <> N'resolved'
                AND (m.undecided_reason IS NOT NULL OR m.data_quality_status = N'unknown_data_gap'
                  OR (ISNULL(m.source_system, N'gtfs') <> N'spare' AND ISNULL(m.detection_type, N'') <> N'explicit_cancellation'
                      AND m.detector_version = N'gtfs-silent-v4' AND m.status = N'escalated'
                      AND (m.expected_window_end_at IS NULL OR m.expected_window_end_at > SYSUTCDATETIME())))
           THEN 1 ELSE 0 END AS held,
      CASE WHEN m.source_system = N'spare' THEN N'spare'
           WHEN m.detection_type = N'explicit_cancellation' THEN N'gtfs_cancellation'
           ELSE N'gtfs_silent_no_show' END AS detector,
      CASE m.validation_status WHEN N'confirmed' THEN N'confirmed_missed_trip'
           WHEN N'timely_service' THEN N'timely_service' WHEN N'false_positive' THEN N'timely_service'
           WHEN N'partial_service_failure' THEN N'partial_service_failure'
           WHEN N'indeterminate' THEN N'indeterminate' END AS review_outcome
    ) mtc_base
    CROSS APPLY (SELECT
      CASE WHEN mtc_base.legacy = 1 THEN N'legacy'
           WHEN mtc_base.reviewed = 1 THEN N'reviewed'
           WHEN mtc_base.resolved = 1 THEN N'closed_by_evidence'
           WHEN mtc_base.held = 1 THEN N'awaiting_evidence'
           WHEN m.status = N'watching' THEN N'open'
           ELSE N'ready_for_review' END AS lifecycle,
      CASE WHEN mtc_base.resolved = 1 AND mtc_base.reviewed = 0 THEN N'timely_service'
           WHEN mtc_base.detector = N'spare' THEN N'on_demand_service_failure'
           WHEN mtc_base.detector = N'gtfs_cancellation' THEN N'advance_cancellation'
           WHEN m.data_quality_status = N'unknown_data_gap' THEN N'indeterminate'
           WHEN m.detected_late_arrival_at > m.grace_deadline_at THEN N'late_trip_start'
           ELSE N'suspected_no_show' END AS evidence_finding,
      mtc_base.review_outcome AS review_outcome,
      mtc_base.detector AS detector,
      CASE WHEN mtc_base.held = 1 THEN COALESCE(m.undecided_reason,
             CASE WHEN m.data_quality_status = N'unknown_data_gap' THEN N'unknown_data_gap' END,
             N'awaiting_operating_window') END AS held_reason,
      CAST(mtc_base.legacy AS BIT) AS legacy,
      CAST(mtc_base.held AS BIT) AS held,
      CAST(CASE WHEN mtc_base.legacy = 0 AND mtc_base.reviewed = 0 AND mtc_base.resolved = 0 AND mtc_base.held = 0 AND m.status <> N'watching' THEN 1 ELSE 0 END AS BIT) AS in_queue,
      CAST(CASE WHEN mtc_base.reviewed = 1 OR mtc_base.resolved = 1 THEN 1 ELSE 0 END AS BIT) AS concluded,
      CAST(CASE WHEN mtc_base.legacy = 0 AND ((mtc_base.reviewed = 0 AND mtc_base.resolved = 0 AND mtc_base.held = 0 AND m.status <> N'watching') OR mtc_base.review_outcome = N'confirmed_missed_trip') THEN 1 ELSE 0 END AS BIT) AS flagged_missed,
      CAST(CASE WHEN mtc_base.legacy = 0 AND mtc_base.review_outcome = N'confirmed_missed_trip' THEN 1 ELSE 0 END AS BIT) AS counts_as_missed,
      CAST(CASE WHEN mtc_base.legacy = 0 AND mtc_base.review_outcome = N'confirmed_missed_trip' AND 1 = 0 THEN 1 ELSE 0 END AS BIT) AS counts_toward_assessment
    ) mtc
LEFT JOIN dbo.RouteClassification classification
  ON classification.route_id = TRY_CONVERT(int, m.route_id)
LEFT JOIN dbo.OtpReasonCodes reason
  ON reason.code = m.reason_code
 AND reason.applies_to = 'missed_trip'
LEFT JOIN dbo.ComplianceOccurrences occurrence
  ON occurrence.source_ref = CONCAT(N'MonitoredMissedTrips:',ISNULL(m.source_system,N'gtfs'),N':',ISNULL(m.source_record_id,m.trip_id),N'|',m.service_date);
GO

SET NOEXEC OFF;
GO

PRINT 'Migration 125 applied: four missed-trip review outcomes, superseding reviews, Expected operating window, vw_MissedTrip classification.';
