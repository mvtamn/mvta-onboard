-- Migration 134: the missed-trip detector promotion history.
--
-- Promotion out of Shadow detection was MISSED_TRIP_PROMOTED_DETECTORS, an app
-- setting: a list of detector names with no date, no reason and no author.
-- Changing it promoted a detector for all of history, so a month already
-- assessed gained missed trips retroactively; nothing recorded who decided or
-- on what evidence; and SQL could not read it, so vw_MissedTrip had to report
-- every detector as unpromoted and disagreed with the app.
--
-- 1. MissedTripDetectorPromotions: an append-only history of promote and demote
--    decisions. Each is effective from a SERVICE date, carries the measured
--    precision and sample size it was decided on, a reason, and the person who
--    decided. The latest decision at or before a case's service date is the
--    one that applies, so promoting today never rewrites last month and
--    demoting a detector leaves the months it was trusted for alone.
-- 2. vw_MissedTrip is regenerated so CountsTowardAssessment reads that history
--    directly - the warehouse now agrees with the app by construction. The
--    CROSS APPLY below is missedTripCaseSql("m", "mtc", PROMOTION_HISTORY)
--    verbatim; classify.test.ts fails if the two drift.
--
-- Nothing is promoted by this migration. The table starts empty, which is
-- exactly what the setting said on dev, so no figure moves when it is applied.
--
-- Re-runnable: the table is created only when missing, and the view is
-- CREATE OR ALTER. Apply it before deploying the code that reads the history.

IF OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL
  THROW 50134, 'Migration 134 requires MonitoredMissedTrips (migration 011) and vw_MissedTrip (migration 125).', 1;
GO

IF OBJECT_ID('dbo.MissedTripDetectorPromotions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.MissedTripDetectorPromotions (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_MissedTripDetectorPromotions PRIMARY KEY DEFAULT NEWID(),
    -- Detector family, not detector version: a new version of a promoted
    -- detector stays promoted (CONTEXT: Shadow detection).
    detector NVARCHAR(40) NOT NULL,
    -- Service date key (YYYYMMDD) the decision takes effect from.
    effective_service_date CHAR(8) NOT NULL,
    promoted BIT NOT NULL,
    reason NVARCHAR(1000) NOT NULL,
    -- The evidence the decision was made on, as measured at the time.
    measured_precision DECIMAL(5,4) NULL,
    sample_size INT NULL,
    decided_by NVARCHAR(200) NOT NULL,
    decided_at DATETIME2 NOT NULL CONSTRAINT DF_MissedTripDetectorPromotions_decided_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_MissedTripDetectorPromotions_detector
      CHECK (detector IN (N'gtfs_cancellation', N'gtfs_silent_no_show', N'spare')),
    CONSTRAINT CK_MissedTripDetectorPromotions_effective
      CHECK (effective_service_date LIKE N'[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')
  );
  CREATE INDEX IX_MissedTripDetectorPromotions_detector
    ON dbo.MissedTripDetectorPromotions (detector, effective_service_date, decided_at);
END
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
      CAST(CASE WHEN mtc_base.legacy = 0 AND mtc_base.review_outcome = N'confirmed_missed_trip' AND ((SELECT TOP 1 p.promoted FROM dbo.MissedTripDetectorPromotions p
        WHERE p.detector = mtc_base.detector AND p.effective_service_date <= LEFT(m.service_date, 8)
        ORDER BY p.effective_service_date DESC, p.decided_at DESC) = 1) THEN 1 ELSE 0 END AS BIT) AS counts_toward_assessment
    ) mtc
LEFT JOIN dbo.RouteClassification classification
  ON classification.route_id = TRY_CONVERT(int, m.route_id)
LEFT JOIN dbo.OtpReasonCodes reason
  ON reason.code = m.reason_code
 AND reason.applies_to = 'missed_trip'
LEFT JOIN dbo.ComplianceOccurrences occurrence
  ON occurrence.source_ref = CONCAT(N'MonitoredMissedTrips:',ISNULL(m.source_system,N'gtfs'),N':',ISNULL(m.source_record_id,m.trip_id),N'|',m.service_date);
GO

PRINT 'Migration 134 applied: missed-trip detector promotion history, vw_MissedTrip reads it.';
