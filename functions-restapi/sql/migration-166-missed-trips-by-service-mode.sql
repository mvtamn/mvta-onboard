-- Migration 166: Missed Trips is two standards, one per service mode.
--
-- MVTA answered on 2026-11-06 (plans/missed-trips-production-plan.md, "Answers
-- received", Q3): fixed route and microtransit are two separate standards.
-- MISSED_TRIPS_FR was seeded by migration 030 as "Missed Trips Fixed Route /
-- Microtransit" and intake sent GTFS and Spare cases to it alike.
--
--   1. MISSED_TRIPS_FR is renamed to say fixed route only.
--   2. MISSED_TRIPS_MT is added for microtransit, with its own tiers. The
--      amounts are COPIED from fixed route ($1,000 a trip, $2,000 for the last
--      trip) as placeholders: what one microtransit trip is, what its last
--      trip is, and what each costs is question F4, still open. The tier notes
--      say so, and so does the console's band list.
--   3. Every active Agreement that scores MISSED_TRIPS_FR scores MISSED_TRIPS_MT
--      over the same dates, so a Spare case scores where it scored yesterday.
--      A period already open keeps its snapshot (AssessmentPeriodStandards) and
--      gains the new standard only when it is re-snapshotted.
--   4. Spare-sourced occurrences on MISSED_TRIPS_FR in a drafting month move
--      to MISSED_TRIPS_MT. A shared, finalized or issued month is left as it
--      is and counted. (None exist on dev today: all 35 Spare cases are
--      unreviewed and none was ever raised.)
--   5. Undecided missed-trip candidates raised before any detector was
--      promoted are dismissed. Today's intake raises a missed-trip candidate
--      only for a detector out of Shadow detection on that service date
--      (ADR-0036); these were raised by the code before that rule, for August
--      2026, and no detector has been promoted for any date. On dev that is 4
--      GTFS candidates from 5 and 7 August. A candidate counts toward nothing,
--      so dismissing them changes no figure: it stops them sitting in the
--      review list as if a decision were owed.
--
-- The code that routes a case to one standard or the other ships with this
-- migration (occurrenceIntake/sources.ts). Until this runs, a Spare case's
-- review finds no MISSED_TRIPS_MT and says the standard is not configured.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
  THROW 50166, 'Migration 166 requires ContractorPerformanceStandards (migration 030).', 1;
IF OBJECT_ID(N'dbo.AgreementStandards', N'U') IS NULL
  THROW 50166, 'Migration 166 requires AgreementStandards (migration 102).', 1;
IF COL_LENGTH('dbo.ContractorPerformanceStandards', 'category') IS NULL
  THROW 50166, 'Migration 166 requires the standard category (migration 110).', 1;
GO

-- 1. Fixed route only.
UPDATE dbo.ContractorPerformanceStandards
SET name = N'Missed Trips (Fixed Route)',
    description = N'A penalty is assessed each time a scheduled fixed route trip is missed due to contractor error, including late pullouts, operator no-shows, or SOP violations. The last trip of a block, before the operator and vehicle return to the garage, is charged at the higher rate.',
    updated_by = N'migration-166', updated_at = SYSUTCDATETIME()
WHERE code = N'MISSED_TRIPS_FR' AND name <> N'Missed Trips (Fixed Route)';
GO

-- The fixed-route tier-2 note named the service day; MVTA's answer names the block.
UPDATE tier
SET notes = N'Last trip of the block on the service date, before return to the garage.',
    updated_by = N'migration-166', updated_at = SYSUTCDATETIME()
FROM dbo.ContractorStandardTiers tier
JOIN dbo.ContractorPerformanceStandards standard ON standard.id = tier.standard_id
WHERE standard.code = N'MISSED_TRIPS_FR' AND tier.qualifier_code = N'LAST_TRIP_OF_DAY' AND tier.agreement_id IS NULL
  AND tier.notes = N'Last scheduled trip of service day';
GO

-- The condition code's words, which the Performance Standards admin shows on the band.
IF OBJECT_ID(N'dbo.ReferenceValues', N'U') IS NOT NULL
  UPDATE dbo.ReferenceValues
  SET label = N'Last trip of the block',
      description = N'Narrows a band to the last trip of a block on its service date, before the operator and vehicle return to the garage.',
      updated_by = N'migration-166', updated_at = SYSUTCDATETIME()
  WHERE domain = N'condition_code' AND value = N'LAST_TRIP_OF_DAY' AND label = N'Last trip of the service day';
GO

-- 2. Microtransit, copying fixed route's catalog columns.
INSERT dbo.ContractorPerformanceStandards
  (code, name, description, standard_type, priority, is_scored, is_safety_critical, direction, unit_label,
   measurement_source, resolver_key, data_source_note, responsible_team, assigned_to, sort_order,
   effective_start_date, band_scope, category, updated_by)
SELECT N'MISSED_TRIPS_MT', N'Missed Trips (Microtransit)',
  N'A penalty is assessed each time a scheduled microtransit trip is missed due to contractor error. What one missed microtransit trip is, and what its last trip is, are still to be agreed with MVTA (question F4).',
  fr.standard_type, fr.priority, fr.is_scored, fr.is_safety_critical, fr.direction, fr.unit_label,
  fr.measurement_source, N'MISSED_TRIPS_MT',
  N'Amounts copied from fixed route as placeholders, pending question F4.',
  fr.responsible_team, fr.assigned_to, fr.sort_order,
  fr.effective_start_date, fr.band_scope, fr.category, N'migration-166'
FROM dbo.ContractorPerformanceStandards fr
WHERE fr.code = N'MISSED_TRIPS_FR'
  AND NOT EXISTS (SELECT 1 FROM dbo.ContractorPerformanceStandards x WHERE x.code = N'MISSED_TRIPS_MT');
GO

-- Its bands: fixed route's catalog ladder, copied, each marked as a placeholder.
INSERT dbo.ContractorStandardTiers
  (standard_id, tier_order, tier_label, bound_low, bound_high, qualifier_code, penalty_basis, penalty_amount,
   triggers_cap, notes, effective_start_date, updated_by)
SELECT mt.id, tier.tier_order, tier.tier_label, tier.bound_low, tier.bound_high, tier.qualifier_code,
  tier.penalty_basis, tier.penalty_amount, tier.triggers_cap,
  CASE WHEN tier.qualifier_code = N'LAST_TRIP_OF_DAY'
    THEN N'Placeholder copied from fixed route, pending F4: what the last trip of a microtransit duty is.'
    ELSE N'Placeholder copied from fixed route, pending F4: what one missed microtransit trip is, and its amount.' END,
  tier.effective_start_date, N'migration-166'
FROM dbo.ContractorPerformanceStandards fr
JOIN dbo.ContractorStandardTiers tier ON tier.standard_id = fr.id AND tier.agreement_id IS NULL AND tier.effective_end_date IS NULL
CROSS JOIN dbo.ContractorPerformanceStandards mt
WHERE fr.code = N'MISSED_TRIPS_FR' AND mt.code = N'MISSED_TRIPS_MT'
  AND NOT EXISTS (SELECT 1 FROM dbo.ContractorStandardTiers existing WHERE existing.standard_id = mt.id AND existing.agreement_id IS NULL);
GO

-- 3. Scored wherever fixed route is scored, over the same dates.
INSERT dbo.AgreementStandards(agreement_id, standard_id, is_scored, effective_start_date, effective_end_date, assignment_note, updated_by)
SELECT fr_assignment.agreement_id, mt.id, fr_assignment.is_scored, fr_assignment.effective_start_date, fr_assignment.effective_end_date,
  N'Split from Missed Trips (Fixed Route) by migration 166: microtransit is its own standard.', N'migration-166'
FROM dbo.AgreementStandards fr_assignment
JOIN dbo.ContractorPerformanceStandards fr ON fr.id = fr_assignment.standard_id AND fr.code = N'MISSED_TRIPS_FR'
JOIN dbo.PerformanceAgreements agreement ON agreement.id = fr_assignment.agreement_id AND agreement.is_active = 1
CROSS JOIN dbo.ContractorPerformanceStandards mt
WHERE mt.code = N'MISSED_TRIPS_MT'
  AND NOT EXISTS (SELECT 1 FROM dbo.AgreementStandards x WHERE x.agreement_id = fr_assignment.agreement_id AND x.standard_id = mt.id);
GO

-- 4. Spare cases in a drafting month move to microtransit, and the month is
-- told its input changed the way intake tells it (assessment/materialChange):
-- revision bumped, a reviewed month goes stale. A month shared for validation
-- needs a Material Assessment Change, which is the console's to make, so it is
-- left alone and counted; so is a finalized or issued month.
IF OBJECT_ID(N'dbo.ComplianceOccurrences', N'U') IS NOT NULL
BEGIN
  DECLARE @moved TABLE(contractor_id UNIQUEIDENTIFIER, service_month CHAR(6));
  UPDATE occurrence
  SET standard_id = mt.id
  OUTPUT inserted.contractor_id, inserted.service_month INTO @moved
  FROM dbo.ComplianceOccurrences occurrence
  JOIN dbo.ContractorPerformanceStandards fr ON fr.id = occurrence.standard_id AND fr.code = N'MISSED_TRIPS_FR'
  CROSS JOIN dbo.ContractorPerformanceStandards mt
  LEFT JOIN dbo.AssessmentPeriods period ON period.contractor_id = occurrence.contractor_id AND period.service_month = occurrence.service_month
  WHERE mt.code = N'MISSED_TRIPS_MT'
    AND occurrence.source_ref LIKE N'MonitoredMissedTrips:spare:%'
    AND (period.id IS NULL OR period.status IN (N'open', N'in_review', N'stale', N'reopened'));
  PRINT CONCAT('Migration 166: ', (SELECT COUNT(*) FROM @moved), ' Spare occurrence(s) moved to MISSED_TRIPS_MT.');

  UPDATE period
  SET input_revision = input_revision + 1,
      status = CASE WHEN status IN (N'in_review', N'stale') THEN N'stale' ELSE status END
  FROM dbo.AssessmentPeriods period
  WHERE EXISTS (SELECT 1 FROM @moved m WHERE m.contractor_id = period.contractor_id AND m.service_month = period.service_month)
    AND period.status IN (N'open', N'in_review', N'stale', N'reopened');

  DECLARE @left INT = (SELECT COUNT(*) FROM dbo.ComplianceOccurrences occurrence
    JOIN dbo.ContractorPerformanceStandards fr ON fr.id = occurrence.standard_id AND fr.code = N'MISSED_TRIPS_FR'
    WHERE occurrence.source_ref LIKE N'MonitoredMissedTrips:spare:%');
  IF @left > 0
    PRINT CONCAT('Migration 166: ', @left, ' Spare occurrence(s) left on MISSED_TRIPS_FR in a shared, finalized or issued month.');
END;
GO

-- 5. Candidates the pre-promotion code raised.
IF OBJECT_ID(N'dbo.ComplianceOccurrences', N'U') IS NOT NULL
BEGIN
  DECLARE @first_promotion CHAR(8) = NULL;
  IF OBJECT_ID(N'dbo.MissedTripDetectorPromotions', N'U') IS NOT NULL
    EXEC sp_executesql N'SELECT @first = MIN(effective_service_date) FROM dbo.MissedTripDetectorPromotions WHERE promoted = 1',
      N'@first CHAR(8) OUTPUT', @first = @first_promotion OUTPUT;

  UPDATE occurrence
  SET review_status = N'dismissed',
      dismiss_reason = N'Raised before any missed-trip detector was promoted out of Shadow detection, so it never counted. Dismissed by migration 166.',
      reviewed_by = N'migration-166', reviewed_at = SYSUTCDATETIME()
  FROM dbo.ComplianceOccurrences occurrence
  JOIN dbo.ContractorPerformanceStandards standard ON standard.id = occurrence.standard_id
    AND standard.code IN (N'MISSED_TRIPS_FR', N'MISSED_TRIPS_MT')
  LEFT JOIN dbo.AssessmentPeriods period ON period.contractor_id = occurrence.contractor_id AND period.service_month = occurrence.service_month
  WHERE occurrence.review_status = N'candidate' AND occurrence.attribution = N'undetermined'
    AND occurrence.source = N'auto_candidate' AND occurrence.source_ref LIKE N'MonitoredMissedTrips:%'
    AND (@first_promotion IS NULL OR occurrence.service_date < @first_promotion)
    AND ISNULL(period.status, N'') NOT IN (N'finalized', N'issued');
  PRINT CONCAT('Migration 166: ', @@ROWCOUNT, ' pre-promotion missed-trip candidate(s) dismissed.');
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ContractorPerformanceStandards WHERE code = N'MISSED_TRIPS_MT' AND resolver_key = N'MISSED_TRIPS_MT')
  THROW 50166, 'Migration 166 did not create MISSED_TRIPS_MT.', 1;
GO

PRINT 'Migration 166 verified: Missed Trips is two standards, fixed route and microtransit.';
