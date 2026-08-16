-- Ticket #64: record the human decision when an Avail-backed detour
-- cannot be fulfilled in Avail and must use a manual operating exception.
IF COL_LENGTH('dbo.Detours', 'fulfillment_change_reason') IS NULL
BEGIN
  ALTER TABLE dbo.Detours ADD fulfillment_change_reason NVARCHAR(1000) NULL;
END;
GO
