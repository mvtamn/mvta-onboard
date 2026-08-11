-- Proposed assignments let Event AVL turn an out-of-scope SpecialEvent
-- observation into reviewed planning scope without changing live operations.
IF OBJECT_ID('dbo.EventVehicleAssignments', 'U') IS NULL
BEGIN
  CREATE TABLE EventVehicleAssignments (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    event_id UNIQUEIDENTIFIER NOT NULL REFERENCES Events(id),
    service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlans(id),
    revision_id UNIQUEIDENTIFIER NULL REFERENCES EventServicePlanRevisions(id),
    vehicle_id INT NOT NULL,
    route_id INT NOT NULL REFERENCES RouteClassification(route_id),
    status NVARCHAR(10) NOT NULL DEFAULT 'proposed',
    reason NVARCHAR(500) NULL,
    requested_by NVARCHAR(200) NOT NULL,
    requested_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    reviewed_by NVARCHAR(200) NULL,
    reviewed_at DATETIME2 NULL,
    CONSTRAINT CK_EventVehicleAssignments_Status CHECK (status IN ('proposed','accepted','applied','rejected'))
  );
  CREATE INDEX IX_EventVehicleAssignments_Context ON EventVehicleAssignments(event_id, service_plan_id, status, requested_at DESC);
END;
GO
PRINT 'Migration 045 applied: Event vehicle assignment proposals created.';
