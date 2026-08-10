-- Controlled revisions keep the currently active service-plan scope live while
-- an administrator prepares and approves changes.
CREATE TABLE EventServicePlanRevisions (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlans(id),
    status NVARCHAR(10) NOT NULL DEFAULT 'draft',
    created_by NVARCHAR(200) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(200) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventServicePlanRevisions_Status CHECK (status IN ('draft','review','approved','applied','rejected'))
);
CREATE TABLE EventServicePlanRevisionRoutes (revision_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlanRevisions(id), route_id INT NOT NULL REFERENCES RouteClassification(route_id), PRIMARY KEY(revision_id, route_id));
CREATE TABLE EventServicePlanRevisionGeofences (revision_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlanRevisions(id), geofence_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventGeofences(id), PRIMARY KEY(revision_id, geofence_id));
CREATE TABLE EventServicePlanRevisionLocations (revision_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlanRevisions(id), location_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventLocations(id), PRIMARY KEY(revision_id, location_id));
GO
PRINT 'Migration 037 applied: service-plan revisions created.';
