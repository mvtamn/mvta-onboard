-- Migration 161: the trips printed on each Count Sheet, in row order
-- (plans/count-sheet-scan-upload.md, decision 8 agreed 2026-11-02).
--
-- A sheet's QR code names the block and date, not the copy. When the Dispatch
-- Log changes a block between the evening print and the morning reprint, two
-- different printed pages carry the same code, and migration 157 kept only a
-- fingerprint of each, which says that they differ but not how. Scanned
-- sheets (Burnsville capture pilot from mid-December) are read row by row,
-- so each row has to map to the trip that was printed on it:
--
--   * RidershipPrintedSheets.trip_ids - a JSON array of the GTFS trip_ids
--     printed on the sheet, row 1 first, across all its pages. NULL on
--     sheets printed before this migration.
--
-- Printing keeps working before this is applied: the print log writes the
-- column only once it exists.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.RidershipPrintedSheets', 'U') IS NULL
  THROW 50161, 'Migration 161 requires the Count Sheet print log (migration 157).', 1;
GO

IF COL_LENGTH('dbo.RidershipPrintedSheets', 'trip_ids') IS NULL
  ALTER TABLE dbo.RidershipPrintedSheets ADD trip_ids NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RidershipPrintedSheets_TripIds')
  ALTER TABLE dbo.RidershipPrintedSheets ADD CONSTRAINT CK_RidershipPrintedSheets_TripIds CHECK (trip_ids IS NULL OR ISJSON(trip_ids) = 1);
GO

PRINT 'Migration 161: Count Sheet print log records the trips printed on each sheet.';
GO
