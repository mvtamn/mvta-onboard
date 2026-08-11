-- First-class Event operating periods use timestamps so overnight operations
-- are scoped correctly. Existing date-only plans remain compatible.
IF COL_LENGTH('dbo.EventServicePlans', 'start_at') IS NULL
  ALTER TABLE EventServicePlans ADD start_at DATETIME2 NULL;
IF COL_LENGTH('dbo.EventServicePlans', 'end_at') IS NULL
  ALTER TABLE EventServicePlans ADD end_at DATETIME2 NULL;
IF COL_LENGTH('dbo.EventServicePlanRevisions', 'start_at') IS NULL
  ALTER TABLE EventServicePlanRevisions ADD start_at DATETIME2 NULL;
IF COL_LENGTH('dbo.EventServicePlanRevisions', 'end_at') IS NULL
  ALTER TABLE EventServicePlanRevisions ADD end_at DATETIME2 NULL;
GO

-- Capture the exact linked scope at activation or revision application. JSON
-- keeps the snapshot immutable without coupling runtime history to reusable
-- resource edits; consumers can materialize typed projections later.
IF OBJECT_ID('dbo.EventServicePlanScopeSnapshots', 'U') IS NULL
BEGIN
  CREATE TABLE EventServicePlanScopeSnapshots (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlans(id),
    revision_id UNIQUEIDENTIFIER NULL REFERENCES EventServicePlanRevisions(id),
    captured_by NVARCHAR(200) NOT NULL,
    captured_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    routes_json NVARCHAR(MAX) NOT NULL,
    geofences_json NVARCHAR(MAX) NOT NULL,
    locations_json NVARCHAR(MAX) NOT NULL,
    rules_json NVARCHAR(MAX) NOT NULL,
    CONSTRAINT CK_EventServicePlanScopeSnapshots_RoutesJson CHECK (ISJSON(routes_json) = 1),
    CONSTRAINT CK_EventServicePlanScopeSnapshots_GeofencesJson CHECK (ISJSON(geofences_json) = 1),
    CONSTRAINT CK_EventServicePlanScopeSnapshots_LocationsJson CHECK (ISJSON(locations_json) = 1),
    CONSTRAINT CK_EventServicePlanScopeSnapshots_RulesJson CHECK (ISJSON(rules_json) = 1)
  );
  CREATE INDEX IX_EventServicePlanScopeSnapshots_Plan ON EventServicePlanScopeSnapshots(service_plan_id, captured_at DESC);
END;
GO

PRINT 'Migration 043 applied: timestamped Event operating periods and scope snapshots created.';

-- Existing active plans must also receive a baseline snapshot before runtime
-- consumers switch to snapshot-backed scope reads.
INSERT INTO EventServicePlanScopeSnapshots(service_plan_id,captured_by,routes_json,geofences_json,locations_json,rules_json)
SELECT p.id, 'migration-043',
  COALESCE((SELECT rc.route_id,rc.route_label,rc.route_category,rc.is_active FROM EventServicePlanRoutes link JOIN RouteClassification rc ON rc.route_id=link.route_id WHERE link.service_plan_id=p.id ORDER BY rc.route_id FOR JSON PATH), '[]'),
  COALESCE((SELECT g.id geofence_id,g.name,g.polygon,g.is_active FROM EventServicePlanGeofences link JOIN EventGeofences g ON g.id=link.geofence_id WHERE link.service_plan_id=p.id ORDER BY g.id FOR JSON PATH), '[]'),
  COALESCE((SELECT l.id location_id,l.name,l.category,l.latitude,l.longitude,l.notes,l.is_active FROM EventServicePlanLocations link JOIN EventLocations l ON l.id=link.location_id WHERE link.service_plan_id=p.id ORDER BY l.id FOR JSON PATH), '[]'),
  COALESCE((SELECT r.* FROM EventServicePlanGeofences link JOIN EventGeofenceDirectionRules r ON r.geofence_id=link.geofence_id WHERE link.service_plan_id=p.id ORDER BY r.geofence_id,r.transition,r.sort_order,r.id FOR JSON PATH), '[]')
FROM EventServicePlans p
WHERE p.status='active'
  AND NOT EXISTS (SELECT 1 FROM EventServicePlanScopeSnapshots snapshot WHERE snapshot.service_plan_id=p.id);
GO
