-- Migration 028: Spare fields required only for Missed Trips. This is not
-- the broader ridership/wait-time/garage integration.

IF OBJECT_ID(N'dbo.SpareMissedTripSource', N'U') IS NULL
BEGIN
CREATE TABLE dbo.SpareMissedTripSource (
    request_id                    NVARCHAR(64)  NOT NULL PRIMARY KEY,
    duty_id                       NVARCHAR(64)  NULL,
    service_id                    NVARCHAR(64)  NULL,
    service_name                  NVARCHAR(128) NULL,
    status                        NVARCHAR(32)  NOT NULL,
    original_scheduled_pickup_at  DATETIME2     NULL,
    scheduled_pickup_at           DATETIME2     NULL,
    pickup_arrived_at             DATETIME2     NULL,
    pickup_lateness_seconds       INT           NULL,
    original_scheduled_dropoff_at DATETIME2     NULL,
    scheduled_dropoff_at          DATETIME2     NULL,
    dropoff_arrived_at            DATETIME2     NULL,
    dropoff_lateness_seconds      INT           NULL,
    cancelled_at                  DATETIME2     NULL,
    cancellation_fault            NVARCHAR(64)  NULL,
    cancellation_reason           NVARCHAR(128) NULL,
    source_updated_at             DATETIME2     NULL,
    ingested_at                   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    raw_payload                   NVARCHAR(MAX) NULL
);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.SpareMissedTripSource')
      AND name = N'IX_SpareMissedTripSource_DutyPickup'
)
    CREATE INDEX IX_SpareMissedTripSource_DutyPickup
        ON dbo.SpareMissedTripSource (duty_id, scheduled_pickup_at);
GO

IF OBJECT_ID(N'dbo.SpareMissedTripSlots', N'U') IS NULL
BEGIN
CREATE TABLE dbo.SpareMissedTripSlots (
    slot_id       NVARCHAR(64) NOT NULL PRIMARY KEY,
    duty_id       NVARCHAR(64) NOT NULL,
    request_id    NVARCHAR(64) NULL,
    slot_type     NVARCHAR(32) NOT NULL,
    scheduled_at  DATETIME2    NULL,
    started_at    DATETIME2    NULL,
    arrived_at    DATETIME2    NULL,
    completed_at  DATETIME2    NULL,
    ingested_at   DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    raw_payload   NVARCHAR(MAX) NULL
);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.SpareMissedTripSlots')
      AND name = N'IX_SpareMissedTripSlots_DutyTypeScheduled'
)
    CREATE INDEX IX_SpareMissedTripSlots_DutyTypeScheduled
        ON dbo.SpareMissedTripSlots (duty_id, slot_type, scheduled_at);
GO

IF OBJECT_ID(N'dbo.SpareMissedTripEvaluations', N'U') IS NULL
BEGIN
CREATE TABLE dbo.SpareMissedTripEvaluations (
    request_id               NVARCHAR(64) NOT NULL PRIMARY KEY
        REFERENCES SpareMissedTripSource(request_id),
    decision_state           NVARCHAR(30) NOT NULL,
    condition_late_start     BIT          NOT NULL DEFAULT 0,
    condition_superseded     BIT          NOT NULL DEFAULT 0,
    condition_late_arrival   BIT          NOT NULL DEFAULT 0,
    start_delay_seconds      INT          NULL,
    arrival_delay_seconds    INT          NULL,
    superseding_slot_at      DATETIME2    NULL,
    unknown_reason           NVARCHAR(100) NULL,
    calculation_version      NVARCHAR(30) NOT NULL,
    evaluated_at             DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    evidence_json            NVARCHAR(MAX) NULL,

    CONSTRAINT CK_SpareMissedTripEvaluations_State
      CHECK (decision_state IN ('candidate', 'not_missed', 'unknown_data_gap'))
);
END;
GO

PRINT 'Migration 028 verified: Spare Missed Trips source, Slots, and evaluation tables are present.';
