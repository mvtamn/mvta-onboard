-- Migration 093: per-recipient delivery receipts for Detour communications.
--
-- ACS accepts an email and returns a message id; whether it reached the
-- mailbox arrives later as an Event Grid EmailDeliveryReportReceived event
-- (Delivered, Bounced, Suppressed, Quarantined, FilteredSpam, Failed...).
-- One row per recipient per send: written as "accepted" by the dispatcher
-- when ACS takes the message, then updated by the receipt endpoint when the
-- provider reports. The parent row's delivery_status gains "delivered" for
-- the case where every recipient's receipt is Delivered, so "sent" can keep
-- meaning accepted.

IF OBJECT_ID('dbo.DetourCommunications', 'U') IS NULL OR COL_LENGTH('dbo.DetourCommunications', 'delivery_status') IS NULL
  THROW 50093, 'Migration 093 requires DetourCommunications with delivery columns (migration 092).', 1;
GO

IF OBJECT_ID('dbo.DetourCommunicationReceipts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DetourCommunicationReceipts (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_DetourCommunicationReceipts PRIMARY KEY DEFAULT NEWID(),
    communication_id UNIQUEIDENTIFIER NOT NULL,
    recipient NVARCHAR(320) NOT NULL,
    provider_message_id NVARCHAR(200) NULL,
    status NVARCHAR(30) NOT NULL,          -- accepted | delivered | bounced | suppressed | quarantined | filtered_spam | failed | expanded
    details NVARCHAR(1000) NULL,
    reported_at DATETIME2(3) NULL,         -- provider timestamp of the receipt
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_DetourCommunicationReceipts_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_DetourCommunicationReceipts_Communication FOREIGN KEY (communication_id) REFERENCES dbo.DetourCommunications(id),
    CONSTRAINT UQ_DetourCommunicationReceipts UNIQUE (communication_id, recipient)
  );
  CREATE INDEX IX_DetourCommunicationReceipts_Provider ON dbo.DetourCommunicationReceipts(provider_message_id);
END;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DetourCommunications_DeliveryStatus')
  ALTER TABLE DetourCommunications DROP CONSTRAINT CK_DetourCommunications_DeliveryStatus;
ALTER TABLE DetourCommunications ADD CONSTRAINT CK_DetourCommunications_DeliveryStatus
  CHECK (delivery_status IN ('not_requested', 'queued', 'sent', 'delivered', 'partially_sent', 'failed', 'skipped'));
GO

PRINT 'Migration 093 applied: DetourCommunicationReceipts created; delivery_status accepts delivered. Subscribe the dispatch app''s /api/acs-email-events endpoint to the ACS resource''s EmailDeliveryReportReceived events.';
