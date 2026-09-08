-- Migration 099: the fleet number on an on-demand departure.
--
-- OnDemandDepartures (migration 096b) stores Spare's vehicle id, an opaque key.
-- The console showed that key in its Vehicle column while the fixed-route
-- view shows Avail's fleet label, the number painted on the bus. Spare calls
-- the same thing the vehicle's identifier (the Ridership Export's
-- vehicleIdentifier, the "Vehicle Report Label" of the spec's section 9.1).
-- onDemandDeparturesPoll now resolves it once per vehicle and records it here.
-- Not personal data: it identifies the bus, not the driver.
--
-- Re-runnable. Run once against the live database (see HANDOFF section 5.7).

IF OBJECT_ID('dbo.OnDemandDepartures', 'U') IS NULL
  THROW 50099, 'Migration 099 requires OnDemandDepartures (migration 096b).', 1;
GO

IF COL_LENGTH('dbo.OnDemandDepartures', 'vehicle_identifier') IS NULL
  ALTER TABLE dbo.OnDemandDepartures ADD vehicle_identifier NVARCHAR(64) NULL;  -- Spare's vehicle identifier: the fleet number
GO

PRINT 'Migration 099 applied: OnDemandDepartures carries vehicle_identifier.';
