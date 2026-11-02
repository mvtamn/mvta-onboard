-- Migration 160: what happened to a rider email after ACS accepted it.
--
-- EmailDeliveryLog could only say queued / sent / bounced / failed, and
-- nothing ever wrote anything but sent or failed. The dispatch app now:
--   * records ACS delivery reports on the log row (acsEmailEvents), so a
--     delivered, bounced, suppressed, quarantined or spam-filtered email says
--     so - and a bounced or suppressed address is not mailed again until the
--     rider confirms it again;
--   * logs a send that never happened because ACS is not configured as
--     'skipped' rather than 'failed', in both delivery logs;
--   * names each email's log row before sending, so the one-click unsubscribe
--     header can point at it (POST /api/subscribers/one-click-unsubscribe).
--
-- This widens the two CHECKs and indexes the provider id the reports are
-- matched on. Before it is applied the new code still works: the statuses it
-- adds are refused and logged, which is what happens today.
--
-- Re-runnable: each CHECK is dropped and re-created, the index created only
-- when missing.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.EmailDeliveryLog', 'U') IS NULL OR OBJECT_ID('dbo.SmsDeliveryLog', 'U') IS NULL
  THROW 50160, 'Migration 160 requires EmailDeliveryLog and SmsDeliveryLog (phase1-schema.sql).', 1;
GO

IF OBJECT_ID('dbo.CK_EmailDeliveryLog_Status', 'C') IS NOT NULL
  ALTER TABLE dbo.EmailDeliveryLog DROP CONSTRAINT CK_EmailDeliveryLog_Status;
ALTER TABLE dbo.EmailDeliveryLog ADD CONSTRAINT CK_EmailDeliveryLog_Status CHECK (delivery_status IN (
  'queued', 'sent', 'skipped', 'failed',
  'delivered', 'bounced', 'suppressed', 'quarantined', 'filtered_spam'
));
GO

IF OBJECT_ID('dbo.CK_SmsDeliveryLog_Status', 'C') IS NOT NULL
  ALTER TABLE dbo.SmsDeliveryLog DROP CONSTRAINT CK_SmsDeliveryLog_Status;
ALTER TABLE dbo.SmsDeliveryLog ADD CONSTRAINT CK_SmsDeliveryLog_Status CHECK (delivery_status IN (
  'queued', 'sent', 'skipped', 'delivered', 'failed'
));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmailDeliveryLog_Provider' AND object_id = OBJECT_ID('dbo.EmailDeliveryLog'))
  CREATE INDEX IX_EmailDeliveryLog_Provider ON dbo.EmailDeliveryLog (provider_message_id)
    WHERE provider_message_id IS NOT NULL;
GO

-- dispatchMessageCreated asks, per subscriber, whether the email bounced since
-- it was last confirmed.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmailDeliveryLog_SubscriberStatus' AND object_id = OBJECT_ID('dbo.EmailDeliveryLog'))
  CREATE INDEX IX_EmailDeliveryLog_SubscriberStatus ON dbo.EmailDeliveryLog (subscriber_id, delivery_status, sent_at);
GO

PRINT 'Migration 160 applied: EmailDeliveryLog/SmsDeliveryLog statuses widened, provider and subscriber indexes added.';
GO
