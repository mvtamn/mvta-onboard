CREATE TABLE EventServicePlans (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    name NVARCHAR(150) NOT NULL,
    status NVARCHAR(10) NOT NULL DEFAULT 'draft',
    start_date DATE NULL,
    end_date DATE NULL,
    created_by NVARCHAR(200) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(200) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventServicePlans_Status CHECK (status IN ('draft','active','completed'))
);
CREATE TABLE EventServicePlanRoutes (service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlans(id), route_id INT NOT NULL REFERENCES RouteClassification(route_id), PRIMARY KEY(service_plan_id, route_id));
CREATE TABLE EventServicePlanGeofences (service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlans(id), geofence_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventGeofences(id), PRIMARY KEY(service_plan_id, geofence_id));
CREATE TABLE EventServicePlanLocations (service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlans(id), location_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventLocations(id), PRIMARY KEY(service_plan_id, location_id));
GO
PRINT 'Migration 034 applied: event service plans created.';
