import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";

// Migration 117, applied to a real SQL Server (the CI contract job's
// container). Three things in it cannot be checked by reading:
//
//   The backfill maps 'opted_out' (a record state) onto 'unsubscribed' (a
//   channel state). Get that mapping wrong and the CHECK added immediately
//   after it rejects rows that already exist, which fails the migration
//   halfway through on the live database and nowhere else.
//
//   UX_SubConfirm_Channel_Token has to let a spent six-digit code be drawn
//   again while refusing a live duplicate. A filtered unique index reads the
//   same either way.
//
//   It is declared re-runnable, which is a promise about ALTER TABLE and
//   DROP INDEX, not only about CREATE TABLE. It is applied twice here.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const FILE = "migration-117-subscriber-channel-state.sql";

async function applyMigration(pool: sql.ConnectionPool) {
  const text = readFileSync(join(process.cwd(), "sql", FILE), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((part) => part.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

// The pre-117 shape, from phase1-schema.sql and migration 002. Built here
// rather than assumed, so the migration is exercised against what it will
// actually meet on the live database - including UX_SubConfirm_Token, the
// index it has to drop.
const BEFORE = `
IF OBJECT_ID('dbo.SubscriberConfirmations','U') IS NOT NULL DROP TABLE dbo.SubscriberConfirmations;
IF OBJECT_ID('dbo.Subscribers','U') IS NOT NULL DROP TABLE dbo.Subscribers;
CREATE TABLE dbo.Subscribers (
  subscriber_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  phone_number NVARCHAR(20) NULL,
  email NVARCHAR(320) NULL,
  routes NVARCHAR(MAX) NULL,
  zones NVARCHAR(MAX) NULL,
  categories NVARCHAR(MAX) NOT NULL,
  status NVARCHAR(30) NOT NULL DEFAULT 'pending_confirmation',
  email_status NVARCHAR(30) NULL,
  opted_in_at DATETIME2 NULL,
  opted_out_at DATETIME2 NULL,
  consent_source NVARCHAR(20) NOT NULL,
  CONSTRAINT CK_Subscribers_Status CHECK (status IN ('pending_confirmation','confirmed','opted_out')),
  CONSTRAINT CK_Subscribers_EmailStatus CHECK (email_status IS NULL OR email_status IN ('pending_confirmation','confirmed','unsubscribed')),
  CONSTRAINT CK_Subscribers_ConsentSource CHECK (consent_source IN ('web_form','mobile_app')),
  CONSTRAINT CK_Subscribers_HasContactMethod CHECK (phone_number IS NOT NULL OR email IS NOT NULL)
);
CREATE TABLE dbo.SubscriberConfirmations (
  confirmation_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  subscriber_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Subscribers(subscriber_id),
  channel NVARCHAR(10) NOT NULL,
  token NVARCHAR(100) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  expires_at DATETIME2 NOT NULL,
  confirmed_at DATETIME2 NULL,
  attempts INT NOT NULL DEFAULT 0,
  CONSTRAINT CK_SubConfirm_Channel CHECK (channel IN ('sms','email'))
);
CREATE UNIQUE INDEX UX_SubConfirm_Token ON dbo.SubscriberConfirmations (token);
`;

test(
  "migration 117 gives each channel its own state and scopes token uniqueness to live rows",
  { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" },
  async () => {
    const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
    try {
      await pool.request().batch(BEFORE);

      // Rows that exist before the migration, in each state the backfill has
      // to account for. The opted-out one is the row that breaks a naive
      // `sms_status = status`.
      await pool.request().batch(`
        INSERT dbo.Subscribers (phone_number, email, categories, status, email_status, consent_source) VALUES
          ('+16125550123', NULL, '["delay"]', 'pending_confirmation', NULL, 'web_form'),
          ('+16125550142', 'both@example.com', '["delay"]', 'confirmed', 'confirmed', 'web_form'),
          ('+16125550143', NULL, '["delay"]', 'opted_out', NULL, 'web_form'),
          (NULL, 'email-only@example.com', '["delay"]', 'confirmed', 'confirmed', 'web_form');`);

      await applyMigration(pool);
      // Declared re-runnable. Applying a migration twice by hand is routine here.
      await applyMigration(pool);

      const backfilled = await pool.request().query<{ phone_number: string | null; status: string; sms_status: string | null }>(
        "SELECT phone_number, status, sms_status FROM dbo.Subscribers ORDER BY ISNULL(phone_number, 'zzz')",
      );
      const byPhone = new Map(backfilled.recordset.map((r) => [r.phone_number, r.sms_status]));
      assert.equal(byPhone.get("+16125550123"), "pending_confirmation", "a pending record's SMS channel is pending");
      assert.equal(byPhone.get("+16125550142"), "confirmed", "a confirmed record's SMS channel is confirmed");
      assert.equal(
        byPhone.get("+16125550143"),
        "unsubscribed",
        "'opted_out' is a record state; the channel's word for it is 'unsubscribed', and the CHECK added straight after the backfill rejects anything else",
      );
      assert.equal(
        byPhone.get(null),
        null,
        "a subscriber with no phone number has no SMS channel to have a state - which is not the same as an unconfirmed one",
      );

      // Each channel's column now stands alone. This is the defect the
      // migration exists for: before it, setting status='confirmed' from the
      // email callback made an unproven phone number SMS-eligible.
      await assert.rejects(
        pool.request().query("UPDATE dbo.Subscribers SET sms_status='opted_out' WHERE phone_number='+16125550123'"),
        /CK_Subscribers_SmsStatus|conflicted/i,
        "a record-level state must not be storable in a channel column",
      );
      await assert.rejects(
        pool.request().query("UPDATE dbo.Subscribers SET opted_out_reason='because' WHERE phone_number='+16125550123'"),
        /CK_Subscribers_OptedOutReason|conflicted/i,
        "an opt-out reason must name a reason the system can act on",
      );
      for (const reason of ["sms_stop", "email_link", "staff"]) {
        await pool.request().query(`UPDATE dbo.Subscribers SET opted_out_reason='${reason}' WHERE phone_number='+16125550123'`);
      }

      const subscriberId = (
        await pool.request().query<{ subscriber_id: string }>(
          "SELECT TOP 1 subscriber_id FROM dbo.Subscribers WHERE phone_number='+16125550123'",
        )
      ).recordset[0].subscriber_id;
      const issue = (token: string, channel = "sms") =>
        pool
          .request()
          .input("s", sql.UniqueIdentifier, subscriberId)
          .input("c", sql.NVarChar, channel)
          .input("t", sql.NVarChar, token)
          .query(
            "INSERT dbo.SubscriberConfirmations (subscriber_id, channel, token, expires_at) VALUES (@s, @c, @t, DATEADD(hour, 24, SYSUTCDATETIME()))",
          );

      await issue("123456");

      // Two live SMS codes may not be the same one: the callback would not know
      // whose subscription a rider just confirmed.
      await assert.rejects(
        issue("123456"),
        /duplicate key|UX_SubConfirm_Channel_Token/i,
        "a second live SMS confirmation with the same code must be refused",
      );

      // The old index was global across channels. An email token and an SMS
      // code that happen to match are not a collision, and refusing that pair
      // is what dropping UX_SubConfirm_Token fixes.
      await issue("123456", "email");

      // A spent code returns to the pool. With only a million of them and no
      // cleanup, uniqueness over all rows ever issued eventually fails every
      // new opt-in.
      await pool.request().query("UPDATE dbo.SubscriberConfirmations SET confirmed_at=SYSUTCDATETIME() WHERE channel='sms' AND token='123456'");
      await issue("123456");

      // A superseded token frees its code the same way - that is the resend
      // path in increment 3.
      await pool.request().query("UPDATE dbo.SubscriberConfirmations SET superseded_at=SYSUTCDATETIME() WHERE channel='sms' AND token='123456' AND confirmed_at IS NULL");
      await issue("123456");

      const live = await pool.request().query<{ n: number }>(
        "SELECT COUNT(*) n FROM dbo.SubscriberConfirmations WHERE channel='sms' AND token='123456' AND confirmed_at IS NULL AND superseded_at IS NULL",
      );
      assert.equal(live.recordset[0].n, 1, "exactly one SMS confirmation for a given code is ever live");

      // attempts has existed since migration 002 and was never written; 117
      // adds the timestamp an attempt cap needs to expire a lockout.
      await pool.request().query("UPDATE dbo.SubscriberConfirmations SET attempts=attempts+1, last_attempt_at=SYSUTCDATETIME() WHERE channel='email'");
      const attempted = await pool.request().query<{ attempts: number; last_attempt_at: Date | null }>(
        "SELECT attempts, last_attempt_at FROM dbo.SubscriberConfirmations WHERE channel='email'",
      );
      assert.equal(attempted.recordset[0].attempts, 1);
      assert.ok(attempted.recordset[0].last_attempt_at instanceof Date, "a counted attempt records when it happened");
    } finally {
      await pool.close();
    }
  },
);
