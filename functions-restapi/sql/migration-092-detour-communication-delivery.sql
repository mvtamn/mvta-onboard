-- Migration 092: server-side delivery for Detour communications.
--
-- Publishing a communication so far recorded a human decision; delivery
-- happened in someone's mail client. This adds the send path: when a
-- published email communication is handed to the dispatch app, the exact
-- subject, body, and recipients are frozen on the row (the immutable
-- sent-body snapshot the detour spec asks for) and delivery progress is
-- written back by the dispatcher. The editable `content` column stays as
-- the draft; `sent_*` is what actually went out.

IF OBJECT_ID('dbo.DetourCommunications', 'U') IS NULL
  THROW 50092, 'Migration 092 requires DetourCommunications (migration 059).', 1;
GO

IF COL_LENGTH('dbo.DetourCommunications', 'delivery_status') IS NULL
BEGIN
  ALTER TABLE DetourCommunications ADD
    delivery_status NVARCHAR(20) NOT NULL CONSTRAINT DF_DetourCommunications_DeliveryStatus DEFAULT 'not_requested',
    delivery_requested_at DATETIME2(3) NULL,
    delivery_completed_at DATETIME2(3) NULL,
    delivery_error NVARCHAR(1000) NULL,
    delivery_provider_id NVARCHAR(200) NULL,
    sent_subject NVARCHAR(500) NULL,
    sent_body NVARCHAR(MAX) NULL,
    sent_recipients NVARCHAR(2000) NULL;
  ALTER TABLE DetourCommunications ADD CONSTRAINT CK_DetourCommunications_DeliveryStatus
    CHECK (delivery_status IN ('not_requested', 'queued', 'sent', 'partially_sent', 'failed', 'skipped'));
END;
GO

PRINT 'Migration 092 applied: DetourCommunications delivery snapshot and status columns added.';
