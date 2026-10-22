-- Database users for the Function Apps' managed identities.
--
-- Step 3 of moving the apps off the SQL admin password (see PR #437): each
-- Function App gets its own Entra user in the OnBoard database, so its
-- connection string can say "Authentication=Active Directory Default" and the
-- server can later run Entra-only.
--
-- Run it as the server's Entra admin, against the OnBoard database (not
-- master). It works out the environment from DB_NAME(), so the same file
-- serves dev and prod and cannot give one environment's apps the other's
-- database. Safe to run again: it creates what is missing, re-applies the
-- grants, and stops on anything it does not expect.
--
--   sqlcmd -S sql-mvta-dev-mvta-jx4471.database.windows.net -d sqldb-mvta-onboard-dev \
--     --authentication-method=ActiveDirectoryAzCli -b -i infra-stage0/scripts/grant-function-app-sql-users.sql
--   sqlcmd -S sql-mvta-prod-b0885v.database.windows.net -d sqldb-mvta-onboard-prod \
--     --authentication-method=ActiveDirectoryAzCli -b -i infra-stage0/scripts/grant-function-app-sql-users.sql
--
-- Prod's database is a copy of dev's, so it arrives holding dev's app users.
-- Those are dropped here. Run it again after the cutover re-copy.
--
-- What each app may do:
--   all three             read and write every table (db_datareader, db_datawriter)
--   REST API only         ALTER on the tables it empties with TRUNCATE (gtfsStopsSync)
--                         or loads with bulk copy (gtfsStopsSync, predictionAccuracy/store).
--                         Bulk copy without CHECK_CONSTRAINTS needs ALTER, not a
--                         database-wide bulk permission.
-- The Spare webhook app runs the REST package but registers only the receiver,
-- so it gets read and write alone. Nothing here can create or drop tables.
--
-- The ids are the identities' object ids (for CREATE USER ... WITH OBJECT_ID)
-- and application ids (SQL stores one of them as the user's SID: the
-- application id for a service principal, as documented). They change only
-- if an app's system-assigned identity is turned off and on again; the SID
-- check below stops the script if that has happened.

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @env nvarchar(10) =
  CASE DB_NAME()
    WHEN N'sqldb-mvta-onboard-dev' THEN N'dev'
    WHEN N'sqldb-mvta-onboard-prod' THEN N'prod'
  END;
IF @env IS NULL
BEGIN
  DECLARE @db nvarchar(128) = DB_NAME();
  RAISERROR(N'Connected to %s. Run this against sqldb-mvta-onboard-dev or sqldb-mvta-onboard-prod.', 16, 1, @db);
  RETURN;
END;

DECLARE @apps TABLE (
  env nvarchar(10) NOT NULL,
  name sysname NOT NULL,
  object_id uniqueidentifier NOT NULL,
  app_id uniqueidentifier NOT NULL,
  is_rest_api bit NOT NULL
);
INSERT @apps VALUES
  (N'dev',  N'func-mvta-restapi-dev',    '29c690d9-3999-44ec-9ce6-4ff81686efb3', 'c7f3e284-a632-4200-b948-80e4c31ad9d3', 1),
  (N'dev',  N'func-mvta-dispatch-dev',   '3ed1e6ac-eae2-4fc7-ae72-f28e2be6d235', '1ea754a4-07bf-4b42-a9e2-3c33e1add37a', 0),
  (N'dev',  N'func-mvta-sparehook-dev',  'e9923b01-6554-4764-ac60-b424c8a13ec7', '1ab51a32-5f06-4d1a-9659-25011c6d8ad2', 0),
  (N'prod', N'func-mvta-restapi-prod',   '08a5028e-8e4e-49a8-81ca-422a1f7c8b3c', '12c7f788-26b0-4994-b79d-ec2532b3134a', 1),
  (N'prod', N'func-mvta-dispatch-prod',  '84589e79-b7d6-43eb-afa0-7df1ddd4e725', '3ddb5ef4-1fd3-4b18-bc10-57434a45a861', 0),
  (N'prod', N'func-mvta-sparehook-prod', '56d35e85-9da3-498a-bc4a-d08d03e32f51', '8d1d763f-fb83-4411-97bb-ebc34c63138c', 0);

DECLARE @alterTables TABLE (name sysname NOT NULL);
INSERT @alterTables VALUES
  (N'GtfsStops'), (N'GtfsTripDirections'), (N'GtfsRoutes'), (N'GtfsStopRoutes'),
  (N'GtfsCalendar'), (N'GtfsCalendarDates'), (N'GtfsScheduledTrips'),
  (N'PredictionAccuracyRouteHours'), (N'PredictionAccuracyStops');

DECLARE @name sysname, @objectId uniqueidentifier, @appId uniqueidentifier, @isRest bit,
        @table sysname, @sql nvarchar(max);

PRINT N'Environment: ' + @env + N' (' + DB_NAME() + N')';

-- 1. Drop the other environment's app users (prod arrives with dev's).
DECLARE stale CURSOR LOCAL FAST_FORWARD FOR
  SELECT dp.name
  FROM sys.database_principals dp
  WHERE dp.name LIKE N'func-mvta-%'
    AND dp.name NOT IN (SELECT name FROM @apps WHERE env = @env);
OPEN stale;
FETCH NEXT FROM stale INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @sql = N'DROP USER ' + QUOTENAME(@name) + N';';
  EXEC sys.sp_executesql @sql;
  PRINT N'  dropped ' + @name + N' (not an app of this environment)';
  FETCH NEXT FROM stale INTO @name;
END;
CLOSE stale;
DEALLOCATE stale;

-- 2. Create each app's user if missing, and check an existing one is the
--    same identity.
DECLARE app CURSOR LOCAL FAST_FORWARD FOR
  SELECT name, object_id, app_id, is_rest_api FROM @apps WHERE env = @env;
OPEN app;
FETCH NEXT FROM app INTO @name, @objectId, @appId, @isRest;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @name)
  BEGIN
    SET @sql = N'CREATE USER ' + QUOTENAME(@name)
             + N' FROM EXTERNAL PROVIDER WITH OBJECT_ID = ''' + CONVERT(nvarchar(36), @objectId) + N''';';
    EXEC sys.sp_executesql @sql;
    PRINT N'  created ' + @name;
  END
  ELSE IF NOT EXISTS (
    SELECT 1 FROM sys.database_principals
    WHERE name = @name AND type = 'E'
      AND sid IN (CAST(@appId AS varbinary(16)), CAST(@objectId AS varbinary(16)))
  )
  BEGIN
    CLOSE app;
    DEALLOCATE app;
    RAISERROR(N'%s exists but is not the identity this script expects (wrong type or SID). If the app''s identity was recreated, update its ids here, DROP USER it and run again.', 16, 1, @name);
    RETURN;
  END
  ELSE
    PRINT N'  ' + @name + N' already exists';

  IF IS_ROLEMEMBER(N'db_datareader', @name) = 0
  BEGIN
    SET @sql = N'ALTER ROLE db_datareader ADD MEMBER ' + QUOTENAME(@name) + N';';
    EXEC sys.sp_executesql @sql;
  END;
  IF IS_ROLEMEMBER(N'db_datawriter', @name) = 0
  BEGIN
    SET @sql = N'ALTER ROLE db_datawriter ADD MEMBER ' + QUOTENAME(@name) + N';';
    EXEC sys.sp_executesql @sql;
  END;
  PRINT N'    read + write';

  IF @isRest = 1
  BEGIN
    DECLARE tbl CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @alterTables;
    OPEN tbl;
    FETCH NEXT FROM tbl INTO @table;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      IF OBJECT_ID(N'dbo.' + QUOTENAME(@table), N'U') IS NULL
        PRINT N'    WARNING: dbo.' + @table + N' does not exist yet (migration not applied?) - run this again after it is';
      ELSE
      BEGIN
        SET @sql = N'GRANT ALTER ON dbo.' + QUOTENAME(@table) + N' TO ' + QUOTENAME(@name) + N';';
        EXEC sys.sp_executesql @sql;
        PRINT N'    ALTER on dbo.' + @table;
      END;
      FETCH NEXT FROM tbl INTO @table;
    END;
    CLOSE tbl;
    DEALLOCATE tbl;
  END;

  FETCH NEXT FROM app INTO @name, @objectId, @appId, @isRest;
END;
CLOSE app;
DEALLOCATE app;

-- 3. What the apps can do now.
SELECT dp.name AS app_user,
       STRING_AGG(r.name, N', ') WITHIN GROUP (ORDER BY r.name) AS roles,
       (SELECT COUNT(*) FROM sys.database_permissions p
         WHERE p.grantee_principal_id = dp.principal_id
           AND p.permission_name = N'ALTER' AND p.state = 'G') AS alter_grants
FROM sys.database_principals dp
LEFT JOIN sys.database_role_members rm ON rm.member_principal_id = dp.principal_id
LEFT JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
WHERE dp.name LIKE N'func-mvta-%'
GROUP BY dp.name, dp.principal_id
ORDER BY dp.name;
