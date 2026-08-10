-- Detour workflow foundation: keep operational workflow separate from the
-- existing date-derived temporal status.

ALTER TABLE Detours ADD fulfillment_mode NVARCHAR(30) NOT NULL CONSTRAINT DF_Detours_FulfillmentMode DEFAULT 'fixed_route_manual';
ALTER TABLE Detours ADD lifecycle_state NVARCHAR(30) NOT NULL CONSTRAINT DF_Detours_LifecycleState DEFAULT 'active';
ALTER TABLE Detours ADD workflow_owner NVARCHAR(200) NULL;
ALTER TABLE Detours ADD workflow_updated_by NVARCHAR(200) NULL;
ALTER TABLE Detours ADD workflow_updated_at DATETIME2 NULL;
ALTER TABLE Detours ADD avail_build_confirmed_at DATETIME2 NULL;
GO

UPDATE Detours
SET fulfillment_mode = CASE WHEN source = 'avail' THEN 'avail' ELSE 'fixed_route_manual' END,
    lifecycle_state = CASE WHEN source = 'avail' THEN 'built_in_avail' ELSE 'active' END;
GO

ALTER TABLE Detours ADD CONSTRAINT CK_Detours_FulfillmentMode
  CHECK (fulfillment_mode IN ('avail', 'fixed_route_manual', 'mobility_manual'));
ALTER TABLE Detours ADD CONSTRAINT CK_Detours_LifecycleState
  CHECK (lifecycle_state IN ('approved', 'pending_avail_build', 'built_in_avail',
                             'build_failed', 'active', 'expired', 'rejected', 'duplicate'));
GO

CREATE INDEX IX_Detours_Workflow ON Detours (fulfillment_mode, lifecycle_state, workflow_owner)
  WHERE is_deleted = 0;
GO

CREATE TABLE DetourIntake (
    id                 UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    detection_source   NVARCHAR(100) NOT NULL,
    description        NVARCHAR(1000) NOT NULL,
    location           NVARCHAR(500) NULL,
    proposed_start_date DATE NULL,
    proposed_end_date   DATE NULL,
    status             NVARCHAR(20) NOT NULL DEFAULT 'pending_review',
    decision_notes     NVARCHAR(1000) NULL,
    reviewed_by        NVARCHAR(200) NULL,
    reviewed_at        DATETIME2 NULL,
    promoted_detour_id UNIQUEIDENTIFIER NULL REFERENCES Detours(id),
    created_by         NVARCHAR(200) NOT NULL,
    created_at         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by         NVARCHAR(200) NULL,
    updated_at         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_DetourIntake_Status CHECK (status IN ('pending_review', 'accepted', 'rejected', 'duplicate'))
);
GO

CREATE INDEX IX_DetourIntake_Status ON DetourIntake (status, created_at);
CREATE UNIQUE INDEX UX_DetourIntake_PromotedDetour ON DetourIntake (promoted_detour_id)
  WHERE promoted_detour_id IS NOT NULL;
GO

CREATE TABLE DetourIntakeSegments (
    id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    intake_id   UNIQUEIDENTIFIER NOT NULL REFERENCES DetourIntake(id),
    routes      NVARCHAR(200) NOT NULL,
    directions  NVARCHAR(MAX) NULL,
    sort_order  INT NOT NULL DEFAULT 0
);
GO

CREATE INDEX IX_DetourIntakeSegments_IntakeId ON DetourIntakeSegments (intake_id);
GO

PRINT 'Migration 041 applied: detour workflow and intake foundation created.';
