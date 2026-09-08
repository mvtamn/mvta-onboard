-- Migration 110: a standard says which part of the contract it belongs to.
--
-- The catalog is 30 standards in one flat list, ordered by sort_order. Nothing
-- groups them, so "how is the contractor doing on safety" is a question a
-- reader answers by knowing which six of the thirty are the safety ones. That
-- knowledge lives in people's heads and in the exhibit, not in the product.
--
-- category is a plain OWNED reference domain (migration 105): MVTA adds,
-- renames, reorders and retires the categories from Administration >
-- Performance Assessment > Lists. The scoring engine does not branch on it and
-- must not - a category is how a catalog is read, not how a month is scored -
-- so it needs no system-row guardrail and is deliberately NOT snapshotted onto
-- AssessmentPeriodStandards. Recategorising a standard changes how a finalised
-- month is grouped in a report; it cannot change what that month cost.
--
-- Nullable, because a standard without a category is a real and correct state:
-- one added tomorrow has no category until somebody decides, and inventing one
-- for it would be worse than leaving the field open.
--
-- The seeded assignment below is a starting point drawn from the exhibit's own
-- structure, not a claim about MVTA's reporting. Every one of them is editable
-- from the standards editor, and changing one affects nothing computed.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.ContractorPerformanceStandards', N'U') IS NULL
  THROW 50110, 'Migration 110 requires ContractorPerformanceStandards (migration 030).', 1;
IF OBJECT_ID(N'dbo.ReferenceValues', N'U') IS NULL
  THROW 50110, 'Migration 110 requires ReferenceValues (migration 105).', 1;
GO

IF COL_LENGTH('dbo.ContractorPerformanceStandards', 'category') IS NULL
  ALTER TABLE dbo.ContractorPerformanceStandards ADD category NVARCHAR(50) NULL;
GO

-- The categories themselves. sort_order is the order a scorecard reads in:
-- what the service did, then who ran it, then whether it was safe, then the
-- fleet, then the rider's experience, then the paperwork.
MERGE dbo.ReferenceValues WITH (HOLDLOCK) AS target
USING (VALUES
  ('service_delivery', N'Service Delivery', N'Whether the scheduled service ran, and ran on time.', 1),
  ('operations',       N'Operations & Supervision', N'How the service was run and supervised on the day.', 2),
  ('staffing',         N'Staffing & Training', N'Whether the people running the service were there and qualified.', 3),
  ('safety',           N'Safety', N'Collisions, inspections, and the safety programme.', 4),
  ('maintenance',      N'Maintenance & Fleet', N'Vehicle availability, reliability and condition.', 5),
  ('customer',         N'Customer Experience', N'What the rider encounters, including accessibility.', 6),
  ('reporting',        N'Reporting & Compliance', N'Records and submissions the contract requires.', 7)
) AS source(value, label, description, sort_order)
  ON target.domain = 'category' AND target.value = source.value
WHEN NOT MATCHED THEN
  INSERT(domain, value, label, description, sort_order, is_active, is_system, updated_by)
  VALUES('category', source.value, source.label, source.description, source.sort_order, 1, 0, N'migration-110');
GO

-- A starting categorisation of the catalog as it stands. Only rows that have
-- no category yet are touched, so a curated assignment is never overwritten by
-- a re-run.
UPDATE s SET category = m.category
FROM dbo.ContractorPerformanceStandards s
JOIN (VALUES
  ('MISSED_TRIPS_FR', 'service_delivery'),
  ('GARAGE_DEPARTURE', 'service_delivery'),
  ('OTP_FIXED_ROUTE', 'service_delivery'),
  ('UNATTENDED_RIDER', 'operations'),
  ('ITMS_LOGIN_FAILURE', 'operations'),
  ('ROAD_SUPERVISOR', 'operations'),
  ('UNIFORM_COMPLIANCE', 'operations'),
  ('OPERATOR_STAFFING', 'staffing'),
  ('OPERATOR_STAFFING_LEVEL', 'staffing'),
  ('PIVOT_COVERAGE', 'staffing'),
  ('PIVOT_MISUSE', 'staffing'),
  ('UNQUALIFIED_OPERATOR', 'staffing'),
  ('INITIAL_TRAINING', 'staffing'),
  ('CORRECTIVE_RETRAINING', 'staffing'),
  ('TRAINING_RECORDS', 'staffing'),
  ('ROSTER_SUBMISSION', 'staffing'),
  ('MECHANIC_STAFFING', 'staffing'),
  ('MECHANIC_TRAINING', 'staffing'),
  ('PREVENTABLE_COLLISIONS', 'safety'),
  ('SAFETY_MEETING', 'safety'),
  ('PRE_POST_TRIP', 'safety'),
  ('SHUTDOWN_VEHICLE', 'safety'),
  ('FLEET_AVAIL_SHORT', 'maintenance'),
  ('FLEET_AVAIL_LONG', 'maintenance'),
  ('AVG_MILES_ROAD_CALLS', 'maintenance'),
  ('BUS_CLEANING', 'maintenance'),
  ('BUS_DEEP_CLEANING', 'maintenance'),
  ('OPERATOR_CONDUCT', 'customer'),
  ('ADA_TITLE_VI', 'customer'),
  ('INCIDENT_REPORTING', 'reporting')
) AS m(code, category) ON m.code = s.code
WHERE s.category IS NULL;
GO
