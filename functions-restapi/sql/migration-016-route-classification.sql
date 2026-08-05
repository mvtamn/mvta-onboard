-- Migration 016: Route Classification + Event Bus Monitoring.
--
-- Every Avail360 feed (OTP, Missed Trips, AVL Reports) returns RouteID as a
-- bare number with no fixed-route-vs-special-event flag anywhere in any
-- feed's schema - confirmed across all three integrations already built.
-- RouteClassification is the one place MVTA OnBoard itself decides "is this
-- RouteID fixed route or special event," so every downstream consumer reads
-- from it rather than guessing from a feed. See detour-and-event-module-
-- implementation-plan.md (Part A).
--
-- An unmatched RouteID is treated as "unclassified" by consumers (LEFT JOIN
-- + COALESCE), not silently assumed to be fixed-route - no separate staging
-- table for this first pass; revisit only if unclassified volume becomes a
-- real problem.

CREATE TABLE RouteClassification (
    route_id             INT           NOT NULL PRIMARY KEY,
    route_category       NVARCHAR(20)  NOT NULL, -- 'FixedRoute' | 'SpecialEvent' | 'OnDemand'
    route_label          NVARCHAR(100) NULL,      -- friendly name, e.g. "Vikings Game Shuttle"
    effective_start_date CHAR(8)       NULL,       -- YYYYMMDD, for a reused event RouteID
    effective_end_date   CHAR(8)       NULL,
    is_active            BIT           NOT NULL DEFAULT 1,
    updated_by           NVARCHAR(200) NULL,
    updated_at           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_RouteClassification_Category CHECK (route_category IN ('FixedRoute', 'SpecialEvent', 'OnDemand'))
);
GO

-- Event-bus live positions - filtered from the existing AVL Reports poll
-- (availAvlPoll.ts already fetches every vehicle every 5 minutes into
-- AvailAvlVehiclePositions; these two tables get an ADDITIONAL write, for
-- SpecialEvent-classified routes only, rather than a second separate fetch
-- against the same feed). CurrentPosition mirrors AvailAvlVehiclePositions'
-- own latest-only shape; History is append-only for post-event playback.
CREATE TABLE EventVehicleCurrentPosition (
    vehicle_id       INT       NOT NULL PRIMARY KEY,
    route            INT       NULL,
    latitude         FLOAT     NOT NULL,
    longitude        FLOAT     NOT NULL,
    heading          FLOAT     NULL,
    report_timestamp DATETIME2 NOT NULL,
    updated_at       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE EventVehiclePositionHistory (
    id               BIGINT IDENTITY(1,1) PRIMARY KEY,
    vehicle_id       INT       NOT NULL,
    route            INT       NULL,
    latitude         FLOAT     NOT NULL,
    longitude        FLOAT     NOT NULL,
    heading          FLOAT     NULL,
    report_timestamp DATETIME2 NOT NULL
);
GO

CREATE INDEX IX_EventVehiclePositionHistory_Vehicle ON EventVehiclePositionHistory (vehicle_id, report_timestamp);
GO

PRINT 'Migration 016 applied: RouteClassification, EventVehicleCurrentPosition, EventVehiclePositionHistory created.';
