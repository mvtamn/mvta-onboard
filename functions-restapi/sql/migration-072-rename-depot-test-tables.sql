-- Rename the initial depot-specific test tables without losing any active tests or delivery history.
IF OBJECT_ID('dbo.EventMonitoringAreaTests', 'U') IS NULL AND OBJECT_ID('dbo.EventDepotDepartureTests', 'U') IS NOT NULL
  EXEC sp_rename 'dbo.EventDepotDepartureTests', 'EventMonitoringAreaTests';
GO

IF OBJECT_ID('dbo.EventMonitoringAreaTestVehicleState', 'U') IS NULL AND OBJECT_ID('dbo.EventDepotDepartureTestVehicleState', 'U') IS NOT NULL
  EXEC sp_rename 'dbo.EventDepotDepartureTestVehicleState', 'EventMonitoringAreaTestVehicleState';
GO

IF OBJECT_ID('dbo.EventMonitoringAreaTestMessages', 'U') IS NULL AND OBJECT_ID('dbo.EventDepotDepartureTestMessages', 'U') IS NOT NULL
  EXEC sp_rename 'dbo.EventDepotDepartureTestMessages', 'EventMonitoringAreaTestMessages';
GO

PRINT 'Migration 072 applied: Monitoring Area test tables renamed.';
