-- Migration 002: double opt-in confirmation tokens.
--
-- Rider opt-in creates a Subscriber in 'pending_confirmation' and issues a
-- short-lived token per contact channel (sms/email). The rider proves control
-- of the phone/email by presenting the token back (SMS reply code or email
-- link), at which point the channel is marked confirmed. No alerts are sent to
-- an unconfirmed channel - this is the TCPA/CTIA double opt-in requirement.
--
-- Run once against the live database. GO separates batches so each statement
-- is validated/compiled against the schema produced by the previous one (SQL
-- Server compiles a whole batch before executing any of it).

CREATE TABLE SubscriberConfirmations (
    confirmation_id  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    subscriber_id    UNIQUEIDENTIFIER NOT NULL REFERENCES Subscribers(subscriber_id),
    channel          NVARCHAR(10)     NOT NULL,          -- 'sms' | 'email'
    token            NVARCHAR(100)    NOT NULL,          -- opaque, url-safe
    created_at       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    expires_at       DATETIME2        NOT NULL,
    confirmed_at     DATETIME2        NULL,
    attempts         INT              NOT NULL DEFAULT 0,

    CONSTRAINT CK_SubConfirm_Channel CHECK (channel IN ('sms', 'email'))
);
GO

CREATE UNIQUE INDEX UX_SubConfirm_Token ON SubscriberConfirmations (token);
GO

CREATE INDEX IX_SubConfirm_Subscriber ON SubscriberConfirmations (subscriber_id, channel);
GO

PRINT 'Migration 002 applied: SubscriberConfirmations table created.';
