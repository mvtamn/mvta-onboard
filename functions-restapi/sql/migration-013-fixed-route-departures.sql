-- Migration 013: Fixed Route Departures (Avail Pullout compliance tracking).
--
-- A second, distinct Avail360 data source from AVL Reports (migration-012) -
-- this is Avail's own dispatch-side report of whether a vehicle left the
-- garage on schedule (check-in, login, and pullout timing, both scheduled
-- and actual, plus Avail's own PulloutStatus classification like
-- 'Late Relief' or 'Expired Pullout'). More authoritative for garage-side
-- lateness than anything inferred from GTFS or AVL data.
--
-- Unlike AvailAvlVehiclePositions (overwrites to each vehicle's latest
-- position only), this table is a GROWING HISTORICAL LOG - every service
-- day's records are retained permanently so late/expired pullouts can be
-- trend-analyzed over time (by operator, by block, by day). The poller
-- MERGEs into it (Actual times/status fill in as the day progresses,
-- keyed by (service_date, block, run)), but never deletes - history
-- accumulates automatically just by the poller running day after day.
--
-- Run once against the live database (private endpoint - see HANDOFF §5.7
-- for the temporary-public-access procedure).

CREATE TABLE FixedRouteDepartures (
    service_date       CHAR(8)       NOT NULL, -- YYYYMMDD, the poll's request date
    block               INT          NOT NULL,
    run                 INT          NOT NULL,
    checkin_scheduled   DATETIME2    NULL,
    checkin_actual      DATETIME2    NULL,
    login_scheduled     DATETIME2    NULL,
    login_actual        DATETIME2    NULL,
    pullout_scheduled   DATETIME2    NULL,
    pullout_actual      DATETIME2    NULL,
    pullout_status      NVARCHAR(30) NULL, -- Avail's own classification (e.g. 'Late Relief', 'Expired Pullout')
    operator_name       NVARCHAR(200) NULL,
    logon_id            INT          NULL,
    vehicle_label       NVARCHAR(20) NULL,
    first_seen_at       DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_FixedRouteDepartures PRIMARY KEY (service_date, block, run)
);
GO

CREATE INDEX IX_FixedRouteDepartures_Status ON FixedRouteDepartures (pullout_status, service_date);
GO

PRINT 'Migration 013 applied: FixedRouteDepartures created.';
