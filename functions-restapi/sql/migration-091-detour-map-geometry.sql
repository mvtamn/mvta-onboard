-- Migration 091: map drawing for Detours, and the stop-to-route index that
-- makes nearby-stop suggestions useful.
--
-- A drawn shape (GeoJSON Point, LineString, or Polygon) on the intake and
-- carried onto the authoritative Detour at acceptance. Stored as JSON text
-- like OnDemandOperationalZones.geometry_json; no spatial types, since the
-- only query is "stops within N metres", done in code against GtfsStops.
--
-- GtfsStopRoutes is the distinct (stop_id, route_id) set from
-- stop_times.txt joined to trips.txt. The static sync already parses
-- stop_times for scheduled trips; keeping this pair index lets the console
-- turn "stops near the closure" into "routes that serve them".

IF OBJECT_ID('dbo.DetourIntake', 'U') IS NULL OR OBJECT_ID('dbo.Detours', 'U') IS NULL
  THROW 50091, 'Migration 091 requires DetourIntake and Detours.', 1;
GO

IF COL_LENGTH('dbo.DetourIntake', 'geometry_json') IS NULL
  ALTER TABLE DetourIntake ADD geometry_json NVARCHAR(MAX) NULL CONSTRAINT CK_DetourIntake_GeometryJson CHECK (geometry_json IS NULL OR ISJSON(geometry_json) = 1);
IF COL_LENGTH('dbo.Detours', 'geometry_json') IS NULL
  ALTER TABLE Detours ADD geometry_json NVARCHAR(MAX) NULL CONSTRAINT CK_Detours_GeometryJson CHECK (geometry_json IS NULL OR ISJSON(geometry_json) = 1);
GO

IF OBJECT_ID('dbo.GtfsStopRoutes', 'U') IS NULL
BEGIN
  CREATE TABLE GtfsStopRoutes (
    stop_id  NVARCHAR(50) NOT NULL,
    route_id NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_GtfsStopRoutes PRIMARY KEY (stop_id, route_id)
  );
  CREATE INDEX IX_GtfsStopRoutes_Route ON GtfsStopRoutes (route_id);
END;
GO

PRINT 'Migration 091 applied: detour geometry columns and GtfsStopRoutes added. Run the static GTFS sync to populate stop routes.';
