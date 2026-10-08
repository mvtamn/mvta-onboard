-- Migration 137: vw_MissedTrip reads the detector promotion history.
--
-- Migration 134 made promotion a dated decision in MissedTripDetectorPromotions
-- (ADR-0036). Until now SQL could not read promotion at all, so every view
-- definition reported CountsTowardAssessment with promotion hard-coded off and
-- the warehouse disagreed with the app the moment anything was promoted.
--
-- Migrations are append-only, so this file - not 134 - is the current definer of
-- the view, and migration 135 now guards its own definition off once the
-- promotion table exists. The CROSS APPLY below is
-- missedTripCaseSql("m", "mtc", PROMOTION_HISTORY) verbatim; classify.test.ts
-- fails if the two drift.
--
-- Both gates are in the column now: a case counts toward an assessment when its
-- detector was promoted ON THAT CASE'S SERVICE DATE (134) and no source is
-- contradicting the review (135).
--
-- Nothing is promoted by this migration. With an empty history every detector
-- reads as unpromoted, exactly as the hard-coded definition did, so no figure
-- moves when it is applied.
--
-- Re-runnable: the view is CREATE OR ALTER. Apply it after 134 and 135.

IF OBJECT_ID('dbo.MissedTripDetectorPromotions', 'U') IS NULL
  THROW 50137, 'Migration 137 requires MissedTripDetectorPromotions (migration 134).', 1;
GO

IF COL_LENGTH('dbo.MonitoredMissedTrips', 'evidence_conflict_at') IS NULL
  THROW 50137, 'Migration 137 requires evidence_conflict_at (migration 135).', 1;
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
  mtc.evidence_conflict HasEvidenceConflict,
  m.evidence_conflict_reason EvidenceConflictReason,
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
      CAST(CASE WHEN m.evidence_conflict_at IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS evidence_conflict,
      CAST(CASE WHEN mtc_base.legacy = 0 AND mtc_base.review_outcome = N'confirmed_missed_trip' AND ((SELECT TOP 1 p.promoted FROM dbo.MissedTripDetectorPromotions p
        WHERE p.detector = mtc_base.detector AND p.effective_service_date <= LEFT(m.service_date, 8)
        ORDER BY p.effective_service_date DESC, p.decided_at DESC) = 1) AND m.evidence_conflict_at IS NULL THEN 1 ELSE 0 END AS BIT) AS counts_toward_assessment
    ) mtc
LEFT JOIN dbo.RouteClassification classification
  ON classification.route_id = TRY_CONVERT(int, m.route_id)
LEFT JOIN dbo.OtpReasonCodes reason
  ON reason.code = m.reason_code
 AND reason.applies_to = 'missed_trip'
LEFT JOIN dbo.ComplianceOccurrences occurrence
  ON occurrence.source_ref = CONCAT(N'MonitoredMissedTrips:',ISNULL(m.source_system,N'gtfs'),N':',ISNULL(m.source_record_id,m.trip_id),N'|',m.service_date);
GO

PRINT 'Migration 137 applied: vw_MissedTrip classifies with the detector promotion history.';
