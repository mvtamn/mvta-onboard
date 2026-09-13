-- Migration 119: the key that lets a rider manage their own subscription, and
-- a record of what they changed.
--
-- Increment A of plans/rider-preference-management-spec.md. A rider sets
-- categories once, at opt-in, and can never change anything again; the opt-in
-- form hardcodes routes and zones to "ALL", so "the routes you ride" in its own
-- subtitle is not a thing anyone can express. This adds what a preference page
-- needs to exist at all.
--
-- WHY NOT A CONFIRMATION TOKEN. SubscriberConfirmations tokens expire in 24
-- hours and are spent on use (migrations 002, 117). A manage link lives in the
-- footer of every alert and has to work in six months.
--
-- WHY NOT subscriber_id. It is a NEWID() GUID, it appears in staff-facing API
-- responses, and it is not a secret. A manage key is a bearer credential - the
-- same thing every unsubscribe link in every mailing list is - so it has to be
-- unguessable, and it has to be separable from the identifier everything else
-- already uses.
--
-- WHY IT DOES NOT EXPIRE. An expiring key is an unsubscribe link that stops
-- working, and a rider who cannot unsubscribe is a complaint with a regulator
-- attached. A long-lived key means a found link exposes a masked contact and
-- the ability to change preferences on it. The second is worth living with and
-- the first is not. Rotation on unsubscribe (increment B) covers the case that
-- does matter: someone who has left must not be re-enrollable from an old link.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

-- 64 hex characters - 32 random bytes. Hex rather than base64url because the
-- backfill below has to generate these in T-SQL, where CONVERT(..., 2) is hex
-- and base64url is a hand-rolled translation; the application generates the
-- same shape with crypto.randomBytes(32).toString("hex"). URL-safe either way.
IF COL_LENGTH('dbo.Subscribers', 'manage_key') IS NULL
  ALTER TABLE dbo.Subscribers ADD manage_key NVARCHAR(64) NULL;
GO

IF COL_LENGTH('dbo.Subscribers', 'manage_key_issued_at') IS NULL
  ALTER TABLE dbo.Subscribers ADD manage_key_issued_at DATETIME2 NULL;
GO

-- Every existing record gets one, including merged and opted-out records. A
-- merged record's key still has to resolve - a link mailed before the merge is
-- in somebody's inbox, and increment B follows merged_into to the survivor
-- rather than answering "no such key" to a rider holding a valid link.
--
-- CRYPT_GEN_RANDOM is non-deterministic and evaluated per row, which is the
-- whole load-bearing assumption here: evaluated once per statement it would
-- give every subscriber the SAME key, and one rider's link would manage
-- everyone. The unique index below is what makes that failure loud instead of
-- silent - it would refuse to build - and migration119.db.contract.test.ts
-- asserts distinct keys across several rows rather than trusting either.
UPDATE dbo.Subscribers
   SET manage_key = CONVERT(NVARCHAR(64), CRYPT_GEN_RANDOM(32), 2),
       manage_key_issued_at = SYSUTCDATETIME()
 WHERE manage_key IS NULL;
GO

-- Filtered to non-null so the column can stay nullable: a row mid-insert has
-- no key yet, and NULLs are not "the same key" as each other.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Subscribers_ManageKey' AND object_id = OBJECT_ID('dbo.Subscribers'))
  CREATE UNIQUE INDEX UX_Subscribers_ManageKey ON dbo.Subscribers (manage_key)
    WHERE manage_key IS NOT NULL;
GO

-- What a rider changed, and when.
--
-- This exists for one scenario: a rider says they unsubscribed and kept
-- getting texts. Without a row that is unanswerable, and it is the kind of
-- complaint that arrives with a regulator's letterhead on it. Audit tables in
-- this codebase are per-module (ProcedureAuditEvents, migration 078) rather
-- than one general table, and this follows that.
--
-- Before and after are stored as JSON rather than as columns per field,
-- because the question asked of this table is always "what did this rider's
-- subscription look like on that date" - never "find every rider who dropped
-- route 470", which is a question about the live rows.
IF OBJECT_ID(N'dbo.SubscriberPreferenceChanges', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.SubscriberPreferenceChanges (
    change_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_SubscriberPreferenceChanges_Id DEFAULT NEWID(),
    subscriber_id  UNIQUEIDENTIFIER NOT NULL,
    changed_at     DATETIME2        NOT NULL CONSTRAINT DF_SubscriberPreferenceChanges_At DEFAULT SYSUTCDATETIME(),
    -- Who made the change, not which endpoint served it. 'rider_page' is the
    -- preference page, 'sms_stop' is a STOP text, 'staff' is the console.
    source         NVARCHAR(20)     NOT NULL,
    -- The subscription before and after, each a JSON object with categories,
    -- routes, zones, sms_status and email_status. NULL "before" is the record
    -- being created.
    before_state   NVARCHAR(MAX)    NULL,
    after_state    NVARCHAR(MAX)    NOT NULL,
    CONSTRAINT PK_SubscriberPreferenceChanges PRIMARY KEY (change_id),
    CONSTRAINT FK_SubscriberPreferenceChanges_Subscriber
      FOREIGN KEY (subscriber_id) REFERENCES dbo.Subscribers(subscriber_id),
    CONSTRAINT CK_SubscriberPreferenceChanges_Source
      CHECK (source IN ('rider_page', 'sms_stop', 'staff')),
    -- Malformed JSON here is only discovered when someone is trying to answer
    -- a complaint, which is the worst moment to discover it.
    CONSTRAINT CK_SubscriberPreferenceChanges_BeforeJson
      CHECK (before_state IS NULL OR ISJSON(before_state) = 1),
    CONSTRAINT CK_SubscriberPreferenceChanges_AfterJson
      CHECK (ISJSON(after_state) = 1)
  );
END
GO

-- The reader's question is always about one rider, newest first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SubscriberPreferenceChanges_Subscriber' AND object_id = OBJECT_ID('dbo.SubscriberPreferenceChanges'))
  CREATE INDEX IX_SubscriberPreferenceChanges_Subscriber
    ON dbo.SubscriberPreferenceChanges (subscriber_id, changed_at DESC);
GO

PRINT 'Migration 119 applied: Subscribers.manage_key/manage_key_issued_at, SubscriberPreferenceChanges.';
