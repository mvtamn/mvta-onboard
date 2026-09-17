-- Migration 128: a route category for service that carries no passengers.
--
-- RouteClassification decides which RouteIDs the fixed-route standards apply
-- to (migration 016), and every category that is not 'FixedRoute' is outside
-- the OTP measurement (ADR 0033). Until now the only choices were FixedRoute,
-- SpecialEvent and OnDemand, so Dead Head, Training Bus, Maintenance and Pivot
-- were all classified FixedRoute - the default that makes an unknown route
-- count rather than silently escape the standard.
--
-- That default is right for an unknown revenue route and wrong for these: a
-- training bus has no published trip to be on time for, and a deadhead move is
-- how a bus reaches the trip it will be measured on. None of them appears in
-- the monthly OTP feed today (dev: zero rows for all four), so no figure moves
-- when they are reclassified - this closes the hole before the feed ever opens
-- it, which is also why it is safe to apply at any time.
--
-- Re-runnable.
SET NOCOUNT ON;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'CK_RouteClassification_Category'
             AND parent_object_id = OBJECT_ID('dbo.RouteClassification'))
  ALTER TABLE dbo.RouteClassification DROP CONSTRAINT CK_RouteClassification_Category;
GO

ALTER TABLE dbo.RouteClassification ADD CONSTRAINT CK_RouteClassification_Category
  CHECK (route_category IN ('FixedRoute', 'SpecialEvent', 'OnDemand', 'NonRevenue'));
GO

-- The four non-revenue RouteIDs MVTA classifies today, by id: 999 Dead Head,
-- 5555 Training Bus, 6666 Maintenance, 7777 Pivot. Only rows still labelled
-- FixedRoute are moved, so a later hand correction is never undone by a
-- re-run.
UPDATE dbo.RouteClassification
   SET route_category = 'NonRevenue',
       updated_by = N'migration-128',
       updated_at = SYSUTCDATETIME()
 WHERE route_id IN (999, 5555, 6666, 7777)
   AND route_category = 'FixedRoute';
GO

PRINT 'Migration 128 applied: NonRevenue route category added; non-revenue RouteIDs reclassified.';
GO
