-- An Event may have multiple active operating periods when their route scopes
-- do not overlap. Route conflict validation, not an Event-wide uniqueness
-- constraint, governs activation.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_EventServicePlans_ActiveEvent' AND object_id = OBJECT_ID('dbo.EventServicePlans'))
  DROP INDEX UX_EventServicePlans_ActiveEvent ON EventServicePlans;
GO
PRINT 'Migration 048 applied: non-overlapping active operating periods may coexist per Event.';
