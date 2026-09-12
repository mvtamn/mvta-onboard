-- Migration 117: per-channel confirmation state, attempt tracking, and why a
-- subscriber opted out.
--
-- Groundwork for closing the double opt-in loop (CURRENT_STATE section 7.2).
-- Nothing today can move a subscriber out of 'pending_confirmation': the
-- confirmation email links to an endpoint that does not exist and the SMS code
-- has no inbound handler. Before those callbacks are written, the columns they
-- write have to be able to hold the answer - and the table as it stands cannot.
--
-- WHY sms_status. 'status' is currently doing two jobs: the record's lifecycle,
-- and the SMS channel's state. dispatchMessageCreated gates SMS on
-- status = 'confirmed' and email on status = 'confirmed' AND
-- email_status = 'confirmed'. So the obvious implementation of the email
-- callback - confirm the link, set status = 'confirmed' - would make an
-- unproven phone number SMS-eligible for any subscriber who gave both
-- contacts. Sending to a number nobody proved they control is the exact thing
-- double opt-in exists to prevent, and it is a TCPA exposure rather than a
-- cosmetic bug. After this migration each channel has its own column and
-- neither can vouch for the other; 'status' is the lifecycle alone.
--
-- WHY the index changes. UX_SubConfirm_Token is UNIQUE on token alone, and SMS
-- tokens are six-digit codes (subscribersCreate: crypto.randomInt). Two pending
-- riders who draw the same code collide and the second opt-in fails, and
-- because rows are never cleaned up the pool of live codes only grows. The
-- uniqueness is also the wrong shape: a reply code is only meaningful for the
-- number that received it. Scoping the index to (channel, token) over live rows
-- makes collisions rare and lets spent codes be reused; the lookup being
-- scoped to the sender is the callback's job, in increment 2.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

-- The SMS channel's own state. Deliberately the same three values as
-- email_status, NOT the three that 'status' uses: a channel is unsubscribed,
-- while a record is opted out. The backfill below maps between them.
IF COL_LENGTH('dbo.Subscribers', 'sms_status') IS NULL
  ALTER TABLE dbo.Subscribers ADD sms_status NVARCHAR(30) NULL;
GO

-- Why a subscriber stopped. Without it an SMS STOP, a click on an email
-- unsubscribe link and an administrative removal are indistinguishable, and
-- the first of those is the one with a compliance record attached to it.
IF COL_LENGTH('dbo.Subscribers', 'opted_out_reason') IS NULL
  ALTER TABLE dbo.Subscribers ADD opted_out_reason NVARCHAR(30) NULL;
GO

-- Backfill before the CHECK is added, so the constraint validates rather than
-- having to be trusted. Existing rows carry their record-level state onto the
-- SMS channel, which is what it meant until now; 'opted_out' becomes the
-- channel's word for the same thing. Rows with no phone number keep NULL -
-- there is no SMS channel to have a state.
UPDATE dbo.Subscribers
   SET sms_status = CASE status WHEN 'opted_out' THEN 'unsubscribed' ELSE status END
 WHERE phone_number IS NOT NULL
   AND sms_status IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Subscribers_SmsStatus')
  ALTER TABLE dbo.Subscribers ADD CONSTRAINT CK_Subscribers_SmsStatus
    CHECK (sms_status IS NULL OR sms_status IN ('pending_confirmation', 'confirmed', 'unsubscribed'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Subscribers_OptedOutReason')
  ALTER TABLE dbo.Subscribers ADD CONSTRAINT CK_Subscribers_OptedOutReason
    CHECK (opted_out_reason IS NULL OR opted_out_reason IN ('sms_stop', 'email_link', 'staff'));
GO

-- When the last presented token was checked, as opposed to when it was issued.
-- The attempts column has existed since migration 002 and has never been
-- written; an attempt cap needs to know when, not only how many, so that a
-- rider locked out by a typo is not locked out forever.
IF COL_LENGTH('dbo.SubscriberConfirmations', 'last_attempt_at') IS NULL
  ALTER TABLE dbo.SubscriberConfirmations ADD last_attempt_at DATETIME2 NULL;
GO

-- Set when a resend replaces this token. Distinct from expiry: an expired
-- token ran out of time, a superseded one was deliberately replaced, and a
-- rider presenting a superseded code should be told the newer one is the live
-- one rather than that theirs expired.
IF COL_LENGTH('dbo.SubscriberConfirmations', 'superseded_at') IS NULL
  ALTER TABLE dbo.SubscriberConfirmations ADD superseded_at DATETIME2 NULL;
GO

-- Replace the global token uniqueness with per-channel uniqueness over live
-- rows only. Dropped and recreated rather than left alongside: leaving the old
-- one keeps the collision it causes.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_SubConfirm_Token' AND object_id = OBJECT_ID('dbo.SubscriberConfirmations'))
  DROP INDEX UX_SubConfirm_Token ON dbo.SubscriberConfirmations;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_SubConfirm_Channel_Token' AND object_id = OBJECT_ID('dbo.SubscriberConfirmations'))
  CREATE UNIQUE INDEX UX_SubConfirm_Channel_Token
    ON dbo.SubscriberConfirmations (channel, token)
    WHERE confirmed_at IS NULL AND superseded_at IS NULL;
GO

-- Unfiltered, unlike the unique index above, and that is the point. The
-- callback has to tell "this code was already used" apart from "there is no
-- such code" - the first is a sensible thing to say to a rider, the second is
-- not - and a filtered index cannot find the spent row it needs to say it.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SubConfirm_Live' AND object_id = OBJECT_ID('dbo.SubscriberConfirmations'))
  CREATE INDEX IX_SubConfirm_Live
    ON dbo.SubscriberConfirmations (channel, token)
    INCLUDE (subscriber_id, expires_at, attempts, confirmed_at, superseded_at);
GO

PRINT 'Migration 117 applied: Subscribers.sms_status/opted_out_reason, SubscriberConfirmations.last_attempt_at/superseded_at, per-channel token uniqueness.';
