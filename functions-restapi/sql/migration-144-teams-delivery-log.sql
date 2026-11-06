-- Migration 144: record each Teams post an announcement makes.
--
-- The compose form has offered "Notify Teams" (Operations, Customer Service)
-- since 1.2.x, and the audience was saved in Messages.channels as
-- "Teams: <audience>" - but nothing ever posted it. The dispatch app now posts
-- one card per audience, and this is where it says what happened: sent,
-- failed (the webhook refused or could not be reached), or skipped (no
-- channel is set up for that audience yet).
--
-- One row per message per audience, not per attempt. The row is also how a
-- Service Bus redelivery of the same message knows an audience already has
-- its post: the SMS and email fan-out can throw after Teams has gone out, and
-- reposting to a channel on every retry is the visible kind of duplicate.
--
-- Sibling of SmsDeliveryLog / EmailDeliveryLog, which are per subscriber;
-- Teams has no subscriber, so it gets its own table rather than a nullable
-- subscriber_id in theirs.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.TeamsDeliveryLog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TeamsDeliveryLog (
    log_id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_TeamsDeliveryLog PRIMARY KEY DEFAULT NEWID(),
    message_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_TeamsDeliveryLog_Message REFERENCES dbo.Messages(message_id),
    audience         NVARCHAR(100)    NOT NULL,
    delivery_status  NVARCHAR(20)     NOT NULL,
    error            NVARCHAR(500)    NULL,
    attempted_at     DATETIME2        NOT NULL CONSTRAINT DF_TeamsDeliveryLog_AttemptedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_TeamsDeliveryLog_Status CHECK (delivery_status IN ('sent', 'failed', 'skipped')),
    CONSTRAINT UQ_TeamsDeliveryLog_MessageAudience UNIQUE (message_id, audience)
  );
END
GO

PRINT 'Migration 144 applied: TeamsDeliveryLog';
GO
