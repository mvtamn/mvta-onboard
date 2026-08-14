SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.Messages', 'U') IS NOT NULL
BEGIN
    IF OBJECT_ID('dbo.CK_Messages_Status', 'C') IS NOT NULL
        ALTER TABLE dbo.Messages DROP CONSTRAINT CK_Messages_Status;

    ALTER TABLE dbo.Messages WITH CHECK ADD CONSTRAINT CK_Messages_Status
        CHECK (status IN ('draft', 'active', 'expired', 'archived', 'retracted'));
    ALTER TABLE dbo.Messages CHECK CONSTRAINT CK_Messages_Status;
END;

COMMIT TRANSACTION;
