-- Migration 096: On-Demand Departures (Spare duty start tracking).
--
-- The on-demand half of garage departure. ADR 0028 scopes the concept to one
-- source per service type: Avail Pullout (FixedRouteDepartures, migration 013)
-- measures fixed route, and Spare measures on-demand duties. This table is the
-- Spare half, one row per duty, keyed by Spare's duty id.
--
-- onboard-spare-integration-spec.md section 6.3 names the sources. The
-- scheduled departure is the duty's startLocation slot when Spare has one,
-- otherwise the duty's requested start; the actual departure is that slot's
-- started time, otherwise the duty's first-seen-in-service-area time. Each
-- side records which it was, so a reader can tell a measured departure from
-- an inferred one.
--
-- Like FixedRouteDepartures this is a GROWING HISTORICAL LOG: the poll
-- (onDemandDeparturesPoll) MERGEs by duty id as a duty's day progresses and
-- never deletes, so history accumulates by the poll running day after day.
-- No rider data, driver names, or raw payloads are stored - ids only.
--
-- Run once against the live database (private endpoint - see HANDOFF section
-- 5.7 for the temporary-public-access procedure). Re-runnable.

IF OBJECT_ID('dbo.OnDemandDepartures', 'U') IS NULL
CREATE TABLE dbo.OnDemandDepartures (
    duty_id              NVARCHAR(64)  NOT NULL,
    service_date         CHAR(8)       NOT NULL, -- YYYYMMDD, agency-local date of the scheduled (else actual) departure
    duty_identifier      NVARCHAR(64)  NULL,     -- Spare's human-readable duty label
    driver_id            NVARCHAR(64)  NULL,
    vehicle_id           NVARCHAR(64)  NULL,
    duty_status          NVARCHAR(32)  NULL,
    departure_scheduled  DATETIME2     NULL,
    scheduled_source     NVARCHAR(32)  NULL,     -- 'slots_startLocation' | 'duties_startRequested'
    departure_actual     DATETIME2     NULL,
    departure_source     NVARCHAR(32)  NULL,     -- 'slots_startLocation' | 'duties_firstSeenInServiceArea'
    slot_id              NVARCHAR(64)  NULL,     -- the startLocation slot, when Spare has one
    source_updated_at    DATETIME2     NULL,     -- newest Spare updatedAt across the duty and its slot
    first_seen_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_OnDemandDepartures PRIMARY KEY (duty_id)
);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.OnDemandDepartures') AND name = 'IX_OnDemandDepartures_ServiceDate'
)
  CREATE INDEX IX_OnDemandDepartures_ServiceDate ON dbo.OnDemandDepartures (service_date, departure_scheduled);
GO

PRINT 'Migration 096 applied: OnDemandDepartures created.';
