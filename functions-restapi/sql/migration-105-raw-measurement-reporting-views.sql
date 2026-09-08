-- Migration 105: reporting views over the raw OTP, missed-trip and garage-
-- departure measurements.
--
-- Migration 031 gave Power BI the ASSESSED layer: finalized periods, scored
-- KPIs, tiers, penalties. It deliberately shows nothing below that line, which
-- is right for a scorecard and useless for the question a scorecard always
-- provokes - "which stops, which trips, which runs?". Answering it today means
-- pointing a report at base tables whose date keys are CHAR(6)/CHAR(8), whose
-- exclusion rules live in TypeScript, and whose column names were written for
-- the poller that fills them. Every one of those is the retrofit that
-- migration 031's own header set out to avoid.
--
-- These are the drill-through views for the three measurements the console
-- actually collects. Same conventions as 031: real DATE/DATETIME2 columns,
-- PascalCase names that surface to end users, read-only grants to
-- mvta_reporting_ro, and nothing recomputed that the application already
-- decides.
--
-- THREE RULES THIS MIGRATION HOLDS TO, each one load-bearing:
--
-- 1. No view re-implements a judgement. The garage-departure rule (variance
--    allowance, settled service day, the Avail status ladder) lives in
--    complianceCandidatesPoll.ts and fixedRouteDepartureOutcome.ts, and the
--    variance is an app setting a view cannot read. So vw_GarageDeparture
--    publishes the FACTS - scheduled, actual, delta, status, settled - and
--    LEFT JOINs the occurrence the poll actually raised. What a report calls
--    "late" is then whatever OnBoard called late, by construction, and the
--    threshold can be changed in one place without a view drifting behind it.
--
-- 2. Exclusions are exposed, not applied. resolveOtpFixedRoute measures the
--    month over FixedRoute-classified routes with approved stop exclusions
--    removed. vw_OtpMonthlyRouteStop emits that same test as IsAssessable, per
--    row, rather than filtering: a report summing OnTime/Total where
--    IsAssessable reproduces the assessed figure exactly, and a report that
--    also wants the raw number - which the contractor is entitled to see, and
--    which the resolver itself returns as rawMetricValue - has it without a
--    second view. Filtering here would have made the excluded half invisible
--    and the two numbers impossible to reconcile.
--
-- 3. Unofficial data says so. OtpDailyRouteStopHour is trending only - its
--    field mapping was never confirmed against a real Avail response and it
--    purges at 90 days (migration 020). It gets a view because withholding it
--    invites someone to query the table directly, but IsOfficialRecord = 0
--    travels with every row, so a dashboard cannot silently mix it into a
--    compliance figure.
--
-- No personal names. FixedRouteDepartures.operator_name and
-- OnDemandDepartures.driver_name are omitted; the views carry logon_id and
-- driver_identifier instead. The standard measures the contractor's
-- performance, not an individual operator's, and a BI dataset shared beyond
-- the console is the wrong place for the difference to stop mattering. The
-- identifiers still support drill-through in OnBoard, which does show names to
-- authorized staff.
--
-- Re-runnable (CREATE OR ALTER throughout). Run once against the live database
-- (private endpoint - see HANDOFF section 5.7).

SET NOCOUNT ON;
GO

-- Views bind to their base objects at creation, so a missing table fails with
-- an unhelpful "invalid object name" hundreds of lines in. Name the dependency
-- instead.
IF OBJECT_ID(N'dbo.OtpMonthlyRouteStopDay', N'U') IS NULL
  THROW 50105, 'Migration 105 requires OtpMonthlyRouteStopDay (migration 014).', 1;
IF OBJECT_ID(N'dbo.OtpDailyRouteStopHour', N'U') IS NULL
  THROW 50105, 'Migration 105 requires OtpDailyRouteStopHour (migration 020).', 1;
IF OBJECT_ID(N'dbo.MonitoredMissedTrips', N'U') IS NULL
  THROW 50105, 'Migration 105 requires MonitoredMissedTrips (migration 011).', 1;
IF OBJECT_ID(N'dbo.FixedRouteDepartures', N'U') IS NULL
  THROW 50105, 'Migration 105 requires FixedRouteDepartures (migration 013).', 1;
IF OBJECT_ID(N'dbo.OnDemandDepartures', N'U') IS NULL
  THROW 50105, 'Migration 105 requires OnDemandDepartures (migration 096b).', 1;
IF OBJECT_ID(N'dbo.ComplianceOccurrences', N'U') IS NULL
  THROW 50105, 'Migration 105 requires ComplianceOccurrences (migration 030).', 1;
IF COL_LENGTH(N'dbo.OnDemandDepartures', N'driver_identifier') IS NULL
  THROW 50105, 'Migration 105 requires OnDemandDepartures.driver_identifier (migration 100).', 1;
GO

-- ---------------------------------------------------------------------------
-- OTP - the authoritative monthly grain.
--
-- Mirrors resolveOtpFixedRoute clause for clause: an unclassified route counts
-- as FixedRoute (so a new route falls under the standard by default rather
-- than escaping it), and only an 'approved' stop exclusion excludes.
-- ---------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_OtpMonthlyRouteStop AS
SELECT
  CONVERT(date, CONCAT(LEFT(otp.service_month, 4), '-', RIGHT(otp.service_month, 2), '-01')) ServiceMonthStart,
  otp.service_month ServiceMonth,
  otp.route_id RouteId,
  COALESCE(classification.route_label, otp.route_label) RouteLabel,
  otp.stop_id StopId,
  otp.stop_name StopName,
  otp.day_of_week DayOfWeek,
  ISNULL(classification.route_category, N'FixedRoute') RouteCategory,
  CONVERT(bit, CASE WHEN ISNULL(classification.route_category, N'FixedRoute') = N'FixedRoute'
                     AND exclusion.id IS NULL THEN 1 ELSE 0 END) IsAssessable,
  CONVERT(bit, CASE WHEN exclusion.id IS NULL THEN 0 ELSE 1 END) IsStopExcluded,
  exclusion.reason_code ExclusionReasonCode,
  reason.label ExclusionReasonLabel,
  exclusion.reviewed_by ExclusionApprovedBy,
  exclusion.reviewed_at ExclusionApprovedAt,
  otp.early EarlyDepartures,
  otp.ontime OnTimeDepartures,
  otp.late LateDepartures,
  otp.missed MissedDepartures,
  otp.actual_departures ActualDepartures,
  otp.total TotalDepartures,
  otp.pct_early PctEarly,
  otp.pct_ontime PctOnTime,
  otp.pct_late PctLate,
  otp.pct_not_ontime PctNotOnTime,
  otp.pct_missed PctMissed,
  CONVERT(bit, 1) IsOfficialRecord,
  otp.first_seen_at FirstSeenAt,
  otp.updated_at UpdatedAt
FROM dbo.OtpMonthlyRouteStopDay otp
LEFT JOIN dbo.RouteClassification classification
  ON classification.route_id = otp.route_id
LEFT JOIN dbo.OtpStopExclusions exclusion
  ON exclusion.service_month = otp.service_month
 AND exclusion.route_id = otp.route_id
 AND exclusion.stop_id = otp.stop_id
 AND exclusion.day_of_week = otp.day_of_week
 AND exclusion.status = 'approved'
LEFT JOIN dbo.OtpReasonCodes reason
  ON reason.code = exclusion.reason_code
 AND reason.applies_to = 'stop';
GO

-- ---------------------------------------------------------------------------
-- OTP - sub-monthly trending. NOT the official record; see rule 3 above.
-- ---------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_OtpDailyRouteStopHour AS
SELECT
  CONVERT(date, otp.calendar_date, 112) ServiceDate,
  CONVERT(date, CONCAT(LEFT(otp.calendar_date, 4), '-', SUBSTRING(otp.calendar_date, 5, 2), '-01')) ServiceMonthStart,
  otp.hour_of_day HourOfDay,
  DATEADD(HOUR, otp.hour_of_day, CONVERT(datetime2, CONVERT(date, otp.calendar_date, 112))) HourStart,
  otp.route_id RouteId,
  COALESCE(classification.route_label, otp.route_label) RouteLabel,
  otp.stop_id StopId,
  otp.stop_name StopName,
  ISNULL(classification.route_category, N'FixedRoute') RouteCategory,
  otp.direction Direction,
  otp.latitude Latitude,
  otp.longitude Longitude,
  otp.early EarlyDepartures,
  otp.ontime OnTimeDepartures,
  otp.late LateDepartures,
  otp.missed MissedDepartures,
  otp.actual_departures ActualDepartures,
  otp.total TotalDepartures,
  otp.pct_early PctEarly,
  otp.pct_ontime PctOnTime,
  otp.pct_late PctLate,
  otp.pct_not_ontime PctNotOnTime,
  otp.pct_missed PctMissed,
  -- Trending only: unverified field mapping, 90-day rolling window. A report
  -- that sums this into a compliance number is reporting something Avail has
  -- never confirmed.
  CONVERT(bit, 0) IsOfficialRecord,
  otp.updated_at UpdatedAt
FROM dbo.OtpDailyRouteStopHour otp
LEFT JOIN dbo.RouteClassification classification
  ON classification.route_id = otp.route_id;
GO

-- ---------------------------------------------------------------------------
-- Missed trips - one row per detected trip, both pipelines.
--
-- MonitoredMissedTrips carries the GTFS fixed-route detector and the Spare
-- on-demand evaluator under one source_system column, so this is one view.
-- Detection is not a finding: only validation_status = 'confirmed' feeds the
-- standard, and only then if the feed was trusted when the candidate poll ran.
-- IsConfirmed and the occurrence columns say which rows crossed which line.
--
-- data_quality_status is published rather than filtered, because its two
-- non-trustworthy values mean opposite things and a report should be able to
-- separate them: 'unknown_data_gap' is a vehicle-position outage that made the
-- trip undecidable (migration 087), 'legacy_unverified' is a row detected
-- before the agency-timezone fix and retained for audit (migration 026).
-- Counting either as a missed trip overstates the contractor's month.
-- ---------------------------------------------------------------------------
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
  m.validation_status ValidationStatus,
  CONVERT(bit, CASE WHEN m.validation_status = N'confirmed' THEN 1 ELSE 0 END) IsConfirmed,
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
  m.last_checked_at LastCheckedAt
FROM dbo.MonitoredMissedTrips m
LEFT JOIN dbo.RouteClassification classification
  ON classification.route_id = TRY_CONVERT(int, m.route_id)
LEFT JOIN dbo.OtpReasonCodes reason
  ON reason.code = m.reason_code
 AND reason.applies_to = 'missed_trip'
LEFT JOIN dbo.ComplianceOccurrences occurrence
  ON occurrence.source_ref = CONCAT(N'MonitoredMissedTrips:', ISNULL(m.source_system, N'gtfs'), N':',
                                    ISNULL(m.source_record_id, m.trip_id), N'|', m.service_date);
GO

-- ---------------------------------------------------------------------------
-- Garage departures - both sources, one grain.
--
-- ADR 0028 scopes the concept to one source per service type: Avail Pullout
-- measures fixed route, Spare duties measure on-demand. They are one standard,
-- so they are one view - a report that had to UNION two datasets itself would
-- be re-deciding, in DAX, a question the ADR already settled.
--
-- What each source alone has stays alongside: block/run/logon for a pullout,
-- duty/slot/provenance for a duty. NULL there means "this source has no such
-- thing", never "unknown".
--
-- IsSettled is computed against the agency-local date, matching
-- settledServiceDateExclusive() - a run is judged only once its service day is
-- over, because Avail's PulloutStatus moves while a run is in progress.
-- 'Central Standard Time' is the Windows identifier for America/Chicago and
-- follows DST; the alternative is a UTC-date comparison that is wrong for the
-- five hours either side of midnight.
-- ---------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_GarageDeparture AS
WITH settled AS (
  SELECT CONVERT(char(8), SYSDATETIMEOFFSET() AT TIME ZONE 'Central Standard Time', 112) service_date_exclusive
),
departure AS (
  SELECT
    CONVERT(nvarchar(32), N'fixed_route') ServiceType,
    CONVERT(nvarchar(32), N'avail_pullout') SourceSystem,
    d.service_date ServiceDateKey,
    CONCAT(N'FixedRouteDepartures:avail_pullout:', d.service_date, N'|', d.block, N'|', d.run) SourceRef,
    CONVERT(nvarchar(128), CONCAT(N'Block ', d.block, N' / run ', d.run)) DepartureLabel,
    d.block Block,
    d.run Run,
    CONVERT(nvarchar(64), NULL) DutyId,
    CONVERT(nvarchar(64), NULL) DutyIdentifier,
    CONVERT(nvarchar(64), NULL) SlotId,
    CONVERT(nvarchar(32), d.pullout_status) StatusLabel,
    d.pullout_scheduled ScheduledAt,
    d.pullout_actual ActualAt,
    CONVERT(nvarchar(32), NULL) ScheduledSource,
    CONVERT(nvarchar(32), NULL) ActualSource,
    d.checkin_scheduled CheckInScheduledAt,
    d.checkin_actual CheckInActualAt,
    d.login_scheduled LoginScheduledAt,
    d.login_actual LoginActualAt,
    CONVERT(nvarchar(64), d.vehicle_label) VehicleRef,
    CONVERT(nvarchar(64), d.logon_id) OperatorRef,
    d.first_seen_at FirstSeenAt,
    d.updated_at UpdatedAt
  FROM dbo.FixedRouteDepartures d
  UNION ALL
  SELECT
    CONVERT(nvarchar(32), N'on_demand'),
    CONVERT(nvarchar(32), N'spare_duties'),
    d.service_date,
    CONCAT(N'OnDemandDepartures:spare_duties:', d.duty_id),
    CONVERT(nvarchar(128), CONCAT(N'Duty ', ISNULL(d.duty_identifier, d.duty_id))),
    CONVERT(int, NULL),
    CONVERT(int, NULL),
    d.duty_id,
    d.duty_identifier,
    d.slot_id,
    CONVERT(nvarchar(32), d.duty_status),
    d.departure_scheduled,
    d.departure_actual,
    d.scheduled_source,
    d.departure_source,
    CONVERT(datetime2, NULL),
    CONVERT(datetime2, NULL),
    CONVERT(datetime2, NULL),
    CONVERT(datetime2, NULL),
    CONVERT(nvarchar(64), d.vehicle_identifier),
    CONVERT(nvarchar(64), d.driver_identifier),
    d.first_seen_at,
    d.updated_at
  FROM dbo.OnDemandDepartures d
)
SELECT
  d.ServiceType,
  d.SourceSystem,
  TRY_CONVERT(date, d.ServiceDateKey, 112) ServiceDate,
  TRY_CONVERT(date, CONCAT(LEFT(d.ServiceDateKey, 4), '-', SUBSTRING(d.ServiceDateKey, 5, 2), '-01')) ServiceMonthStart,
  d.DepartureLabel,
  d.Block,
  d.Run,
  d.DutyId,
  d.DutyIdentifier,
  d.SlotId,
  d.StatusLabel,
  d.ScheduledAt ScheduledDepartureAt,
  d.ActualAt ActualDepartureAt,
  -- Signed: a negative delta is an early departure, which is not a breach but
  -- is worth seeing. Both units, because a report needs minutes and a
  -- threshold comparison needs the seconds the poll itself uses.
  CASE WHEN d.ScheduledAt IS NULL OR d.ActualAt IS NULL THEN NULL
       ELSE DATEDIFF(SECOND, d.ScheduledAt, d.ActualAt) END DepartureDeltaSeconds,
  CASE WHEN d.ScheduledAt IS NULL OR d.ActualAt IS NULL THEN NULL
       ELSE DATEDIFF(SECOND, d.ScheduledAt, d.ActualAt) / 60.0 END DepartureDeltaMinutes,
  -- A measured departure and an inferred one are not the same evidence, and on
  -- the Spare side only the row itself knows which it was.
  d.ScheduledSource,
  d.ActualSource,
  CONVERT(bit, CASE WHEN d.ScheduledAt IS NULL THEN 0 ELSE 1 END) HasScheduledDeparture,
  CONVERT(bit, CASE WHEN d.ActualAt IS NULL THEN 0 ELSE 1 END) HasActualDeparture,
  CONVERT(bit, CASE WHEN d.ServiceDateKey < settled.service_date_exclusive THEN 1 ELSE 0 END) IsSettled,
  d.CheckInScheduledAt,
  d.CheckInActualAt,
  d.LoginScheduledAt,
  d.LoginActualAt,
  d.VehicleRef,
  d.OperatorRef,
  occurrence.id OccurrenceId,
  occurrence.review_status OccurrenceReviewStatus,
  occurrence.attribution OccurrenceAttribution,
  occurrence.dismiss_reason OccurrenceDismissReason,
  -- The application's own judgement, not this view's: the candidate poll
  -- raised an occurrence for exactly the departures that broke the rule.
  CONVERT(bit, CASE WHEN occurrence.id IS NULL THEN 0 ELSE 1 END) IsCandidate,
  CONVERT(bit, CASE WHEN occurrence.review_status = N'confirmed'
                     AND occurrence.attribution = N'contractor_error' THEN 1 ELSE 0 END) IsAssessed,
  d.SourceRef,
  d.FirstSeenAt,
  d.UpdatedAt
FROM departure d
CROSS JOIN settled
LEFT JOIN dbo.ComplianceOccurrences occurrence ON occurrence.source_ref = d.SourceRef;
GO

-- ---------------------------------------------------------------------------
-- Feed health - so a dashboard can state its own caveats.
--
-- Migration 031's design calls for a data-completeness page "so MVTA and the
-- contractor are looking at the same caveats the report states". The assessed
-- side has data_completeness_pct; the raw side has this ledger, which is what
-- the candidate poll's own trust gates read before they raise anything.
-- StaleHours is left to the reader to threshold: service runs 08:00-22:00
-- agency-local, so an empty overnight poll is health, not staleness, and a
-- fixed cutoff baked in here would report a healthy night as an outage.
-- ---------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_MeasurementFeedHealth AS
SELECT
  h.feed_name FeedName,
  h.last_success_at LastSuccessAt,
  h.last_entity_count LastEntityCount,
  h.source_timestamp_at SourceTimestampAt,
  h.coverage_start_at CoverageStartAt,
  h.coverage_end_at CoverageEndAt,
  h.last_failure_at LastFailureAt,
  h.last_failure_reason LastFailureReason,
  DATEDIFF(MINUTE, h.last_success_at, SYSUTCDATETIME()) / 60.0 StaleHours,
  CONVERT(bit, CASE WHEN h.last_failure_at IS NOT NULL
                     AND (h.last_success_at IS NULL OR h.last_failure_at > h.last_success_at)
                    THEN 1 ELSE 0 END) LastRunFailed,
  h.updated_at UpdatedAt
FROM dbo.KpiFeedHealth h;
GO

-- Read-only, same as migration 031. The reporting login exists to be pointed
-- at views; it is granted nothing on a base table, so a view dropped from this
-- list is a view the dashboard cannot reach.
IF DATABASE_PRINCIPAL_ID(N'mvta_reporting_ro') IS NOT NULL
BEGIN
    GRANT SELECT ON dbo.vw_OtpMonthlyRouteStop TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_OtpDailyRouteStopHour TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_MissedTrip TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_GarageDeparture TO mvta_reporting_ro;
    GRANT SELECT ON dbo.vw_MeasurementFeedHealth TO mvta_reporting_ro;
    DENY SELECT ON dbo.MonitoredMissedTrips TO mvta_reporting_ro;
    DENY SELECT ON dbo.FixedRouteDepartures TO mvta_reporting_ro;
    DENY SELECT ON dbo.OnDemandDepartures TO mvta_reporting_ro;
END;
GO

PRINT 'Migration 105 applied: raw measurement reporting views created (vw_OtpMonthlyRouteStop, vw_OtpDailyRouteStopHour, vw_MissedTrip, vw_GarageDeparture, vw_MeasurementFeedHealth).';
