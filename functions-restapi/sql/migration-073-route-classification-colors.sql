-- Migration 073: operator-selected Event AVL route marker colors.
-- RouteClassification is the existing source of Event AVL route identity,
-- so presentation color lives with its display label rather than in a second
-- lookup table. Existing routes retain the MVTA evergreen marker.

SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.RouteClassification', 'U') IS NULL
    THROW 50073, 'Migration 073 requires dbo.RouteClassification. Apply migration 016 first.', 1;

  IF COL_LENGTH('dbo.RouteClassification', 'route_color') IS NULL
    ALTER TABLE dbo.RouteClassification
      ADD route_color CHAR(7) NOT NULL
        CONSTRAINT DF_RouteClassification_RouteColor DEFAULT ('#00553D') WITH VALUES;

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.RouteClassification')
      AND name = 'CK_RouteClassification_RouteColor'
  )
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.RouteClassification
        ADD CONSTRAINT CK_RouteClassification_RouteColor
        CHECK (route_color LIKE ''#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'');';

  IF OBJECT_ID('dbo.RouteClassificationHistory', 'U') IS NOT NULL
     AND COL_LENGTH('dbo.RouteClassificationHistory', 'route_color') IS NULL
    ALTER TABLE dbo.RouteClassificationHistory ADD route_color CHAR(7) NULL;

  IF COL_LENGTH('dbo.RouteClassification', 'route_color') IS NULL
    THROW 50074, 'Migration 073 did NOT apply: dbo.RouteClassification.route_color is missing.', 1;

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.RouteClassification')
      AND name = 'CK_RouteClassification_RouteColor'
  )
    THROW 50075, 'Migration 073 did NOT apply: route color validation constraint is missing.', 1;

  IF OBJECT_ID('dbo.RouteClassificationHistory', 'U') IS NOT NULL
     AND COL_LENGTH('dbo.RouteClassificationHistory', 'route_color') IS NULL
    THROW 50076, 'Migration 073 did NOT apply: dbo.RouteClassificationHistory.route_color is missing.', 1;

  COMMIT TRANSACTION;
  PRINT 'Migration 073 applied: Event AVL route marker colors added.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO
