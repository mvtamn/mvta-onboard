-- Migration 120: when a rider last asked for the link to their own
-- subscription.
--
-- Increment D of plans/rider-preference-management-spec.md.
-- POST /api/subscribers/manage-link sends a rider their manage link when they
-- have lost it. It answers the same way for every contact, which stops it
-- being a way to ask whether a number or address is subscribed. This column is
-- what stops it being the other thing an unauthenticated "send a message to
-- this contact" endpoint is: a way to make OnBoard text or email somebody over
-- and over, on demand. One request per record per two minutes.
--
-- WHY ONE COLUMN, NOT ONE PER CHANNEL. A rider needs one link. Throttling both
-- channels together is the stricter choice, and alternating channels would not
-- make flooding a contact meaningfully easier, since each channel reaches a
-- different contact anyway.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF COL_LENGTH('dbo.Subscribers', 'manage_link_sent_at') IS NULL
  ALTER TABLE dbo.Subscribers ADD manage_link_sent_at DATETIME2 NULL;
GO

PRINT 'Migration 120 applied: Subscribers.manage_link_sent_at.';
