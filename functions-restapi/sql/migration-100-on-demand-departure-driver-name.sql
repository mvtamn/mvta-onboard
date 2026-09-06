-- Migration 100: the driver's name on an on-demand departure.
--
-- OnDemandDepartures (migration 096) stores Spare's driver id, an opaque key,
-- and the console showed it as such while the fixed-route view shows Avail's
-- operator name and badge. Reviewing garage departures is reviewing an
-- operator's departures, so the two views should name them alike.
-- onDemandDeparturesPoll now resolves each driver once through
-- GET /v1/drivers/{id} and records the name in the fixed-route feed's
-- "Last, First" order, plus Spare's driver identifier when the agency keeps
-- one. This is personal data of MVTA's contractor's staff, held for the same
-- reason and to the same extent as FixedRouteDepartures.operator_name;
-- contact details are never read.
--
-- Re-runnable. Run once against the live database (see HANDOFF section 5.7).

IF OBJECT_ID('dbo.OnDemandDepartures', 'U') IS NULL
  THROW 50100, 'Migration 100 requires OnDemandDepartures (migration 096).', 1;
GO

IF COL_LENGTH('dbo.OnDemandDepartures', 'driver_name') IS NULL
  ALTER TABLE dbo.OnDemandDepartures ADD driver_name NVARCHAR(128) NULL;       -- "Last, First", from Spare's driver record
GO

IF COL_LENGTH('dbo.OnDemandDepartures', 'driver_identifier') IS NULL
  ALTER TABLE dbo.OnDemandDepartures ADD driver_identifier NVARCHAR(64) NULL;  -- Spare's driver identifier, when the agency keeps one
GO

PRINT 'Migration 100 applied: OnDemandDepartures carries driver_name and driver_identifier.';
