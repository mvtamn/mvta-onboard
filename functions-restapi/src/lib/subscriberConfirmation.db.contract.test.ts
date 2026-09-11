import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import { confirmEmail, confirmSms, optOut, MAX_CONFIRM_ATTEMPTS } from "./subscriberConfirmation";

// The state machine against a real SQL Server (the CI contract job's
// container). classifyConfirmation is unit-tested; everything here is the half
// that only a database can answer:
//
//   The channel column is interpolated into the UPDATE by name, so the wrong
//   channel writing the wrong column is a live possibility that reads fine.
//
//   optOut's UPDATE runs a CASE over the OTHER channel's column and then
//   returns @@ROWCOUNT from a second statement in the same batch. Whether the
//   driver hands back that recordset, and whether the CASE sees the row's
//   pre-UPDATE values, are facts about SQL Server, not about the code.
//
//   The confirming UPDATE and the lookup that precedes it are one transaction
//   under UPDLOCK. A half-applied confirmation - a spent token on an
//   unconfirmed channel, or the reverse - is not recoverable without a human.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

// The pre-117 shape, then the real migration on top, so the module is
// exercised against exactly what it will meet on the live database.
const BEFORE = `
IF OBJECT_ID('dbo.SubscriberConfirmations','U') IS NOT NULL DROP TABLE dbo.SubscriberConfirmations;
IF OBJECT_ID('dbo.Subscribers','U') IS NOT NULL DROP TABLE dbo.Subscribers;
CREATE TABLE dbo.Subscribers (
  subscriber_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  phone_number NVARCHAR(20) NULL, email NVARCHAR(320) NULL,
  routes NVARCHAR(MAX) NULL, zones NVARCHAR(MAX) NULL, categories NVARCHAR(MAX) NOT NULL,
  status NVARCHAR(30) NOT NULL DEFAULT 'pending_confirmation',
  email_status NVARCHAR(30) NULL, opted_in_at DATETIME2 NULL, opted_out_at DATETIME2 NULL,
  consent_source NVARCHAR(20) NOT NULL,
  CONSTRAINT CK_Subscribers_Status CHECK (status IN ('pending_confirmation','confirmed','opted_out')),
  CONSTRAINT CK_Subscribers_EmailStatus CHECK (email_status IS NULL OR email_status IN ('pending_confirmation','confirmed','unsubscribed')),
  CONSTRAINT CK_Subscribers_ConsentSource CHECK (consent_source IN ('web_form','mobile_app'))
);
CREATE TABLE dbo.SubscriberConfirmations (
  confirmation_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  subscriber_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Subscribers(subscriber_id),
  channel NVARCHAR(10) NOT NULL, token NVARCHAR(100) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), expires_at DATETIME2 NOT NULL,
  confirmed_at DATETIME2 NULL, attempts INT NOT NULL DEFAULT 0,
  CONSTRAINT CK_SubConfirm_Channel CHECK (channel IN ('sms','email'))
);
CREATE UNIQUE INDEX UX_SubConfirm_Token ON dbo.SubscriberConfirmations (token);
`;

async function reset(pool: sql.ConnectionPool) {
  await pool.request().batch(BEFORE);
  const text = readFileSync(join(process.cwd(), "sql", "migration-117-subscriber-channel-state.sql"), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

interface Seed {
  phone?: string | null;
  email?: string | null;
  smsToken?: string;
  emailToken?: string;
  expiresInHours?: number;
  status?: string;
}

async function seed(pool: sql.ConnectionPool, s: Seed): Promise<string> {
  const id = (
    await pool
      .request()
      .input("phone", sql.NVarChar(20), s.phone ?? null)
      .input("email", sql.NVarChar(320), s.email ?? null)
      .input("sms", sql.NVarChar(30), s.phone ? "pending_confirmation" : null)
      .input("em", sql.NVarChar(30), s.email ? "pending_confirmation" : null)
      .input("status", sql.NVarChar(30), s.status ?? "pending_confirmation")
      .query<{ subscriber_id: string }>(
        `INSERT dbo.Subscribers (phone_number, email, categories, status, sms_status, email_status, consent_source)
         OUTPUT INSERTED.subscriber_id
         VALUES (@phone, @email, '["delay"]', @status, @sms, @em, 'web_form')`,
      )
  ).recordset[0].subscriber_id;

  const hours = s.expiresInHours ?? 24;
  for (const [channel, token] of [["sms", s.smsToken], ["email", s.emailToken]] as const) {
    if (!token) continue;
    await pool
      .request()
      .input("s", sql.UniqueIdentifier, id)
      .input("c", sql.NVarChar(10), channel)
      .input("t", sql.NVarChar(100), token)
      .input("h", sql.Int, hours)
      .query(
        `INSERT dbo.SubscriberConfirmations (subscriber_id, channel, token, expires_at)
         VALUES (@s, @c, @t, DATEADD(hour, @h, SYSUTCDATETIME()))`,
      );
  }
  return id;
}

async function readSubscriber(pool: sql.ConnectionPool, id: string) {
  return (
    await pool.request().input("id", sql.UniqueIdentifier, id).query<{
      status: string;
      sms_status: string | null;
      email_status: string | null;
      opted_in_at: Date | null;
      opted_out_at: Date | null;
      opted_out_reason: string | null;
    }>("SELECT status, sms_status, email_status, opted_in_at, opted_out_at, opted_out_reason FROM dbo.Subscribers WHERE subscriber_id=@id")
  ).recordset[0];
}

/** Run one operation in its own transaction, the way a handler will. */
async function inTx<T>(pool: sql.ConnectionPool, fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };

test("confirming a channel confirms that channel and no other", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, {
      phone: "+19523883275",
      email: "both@example.com",
      smsToken: "123456",
      emailToken: "email-token-aaa",
    });

    // The defect migration 117 exists for: confirming the email link must not
    // make the unproven phone number eligible for texts.
    const email = await inTx(pool, (tx) => confirmEmail(tx, "email-token-aaa"));
    assert.equal(email.outcome, "confirmed");
    assert.equal(email.subscriberId, id);

    let row = await readSubscriber(pool, id);
    assert.equal(row.email_status, "confirmed");
    assert.equal(row.sms_status, "pending_confirmation", "the other channel is untouched");
    assert.equal(row.status, "confirmed", "a record with a confirmed channel is confirmed");
    assert.ok(row.opted_in_at instanceof Date);
    const firstConsent = row.opted_in_at!.getTime();

    const sms = await inTx(pool, (tx) => confirmSms(tx, "+19523883275", "123456"));
    assert.equal(sms.outcome, "confirmed");
    row = await readSubscriber(pool, id);
    assert.equal(row.sms_status, "confirmed");
    assert.equal(
      row.opted_in_at!.getTime(),
      firstConsent,
      "opted_in_at is when this person agreed, not when the last channel caught up",
    );
  } finally {
    await pool.close();
  }
});

test("a wrong code is counted against the live confirmation and capped", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    await seed(pool, { phone: "+16125550142", smsToken: "999999" });

    for (let i = 1; i <= MAX_CONFIRM_ATTEMPTS; i++) {
      const wrong = await inTx(pool, (tx) => confirmSms(tx, "+16125550142", "000000"));
      assert.equal(wrong.outcome, "incorrect_code", `attempt ${i} is a wrong code, not a missing one`);
      assert.equal(wrong.attemptsRemaining, MAX_CONFIRM_ATTEMPTS - i);
    }

    // Past the cap the right code no longer works either - otherwise the cap
    // only slows a guesser down rather than stopping them.
    const capped = await inTx(pool, (tx) => confirmSms(tx, "+16125550142", "999999"));
    assert.equal(capped.outcome, "too_many_attempts");

    const attempts = await pool.request().query<{ attempts: number; last_attempt_at: Date | null }>(
      "SELECT attempts, last_attempt_at FROM dbo.SubscriberConfirmations WHERE channel='sms'",
    );
    assert.equal(attempts.recordset[0].attempts, MAX_CONFIRM_ATTEMPTS);
    assert.ok(attempts.recordset[0].last_attempt_at instanceof Date);
  } finally {
    await pool.close();
  }
});

test("a code only works for the number it was sent to", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const mine = await seed(pool, { phone: "+16125550142", smsToken: "111111" });
    const theirs = await seed(pool, { phone: "+16125550143", smsToken: "222222" });

    // Presenting somebody else's code from your own number must not confirm
    // either subscription. Before migration 117 the token was globally unique,
    // which made a token-keyed lookup look reasonable - this is why it is not.
    const crossed = await inTx(pool, (tx) => confirmSms(tx, "+16125550142", "222222"));
    assert.equal(crossed.outcome, "incorrect_code");
    assert.equal(crossed.subscriberId, mine, "counted against the guesser's own confirmation");

    assert.equal((await readSubscriber(pool, theirs)).sms_status, "pending_confirmation");
    assert.equal((await readSubscriber(pool, mine)).sms_status, "pending_confirmation");
  } finally {
    await pool.close();
  }
});

test("replying twice reads as done, and an unknown number as not found", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    await seed(pool, { phone: "+16125550142", smsToken: "333333" });

    assert.equal((await inTx(pool, (tx) => confirmSms(tx, "+16125550142", "333333"))).outcome, "confirmed");
    const again = await inTx(pool, (tx) => confirmSms(tx, "+16125550142", "333333"));
    assert.equal(again.outcome, "already_confirmed", "a rider who replies twice has not made a mistake");

    const stranger = await inTx(pool, (tx) => confirmSms(tx, "+15555550100", "333333"));
    assert.equal(stranger.outcome, "not_found");
  } finally {
    await pool.close();
  }
});

test("an expired link is refused and leaves the channel alone", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, { email: "late@example.com", emailToken: "stale-token", expiresInHours: -1 });
    const result = await inTx(pool, (tx) => confirmEmail(tx, "stale-token"));
    assert.equal(result.outcome, "expired");
    const row = await readSubscriber(pool, id);
    assert.equal(row.email_status, "pending_confirmation");
    assert.equal(row.status, "pending_confirmation");
  } finally {
    await pool.close();
  }
});

test("STOP stops texts, leaves a live email subscription, and voids the pending code", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, {
      phone: "+16125550142",
      email: "keeps-email@example.com",
      smsToken: "444444",
      emailToken: "email-token-bbb",
    });
    await inTx(pool, (tx) => confirmEmail(tx, "email-token-bbb"));

    const result = await inTx(pool, (tx) => optOut(tx, "sms", "+16125550142", "sms_stop"));
    assert.equal(result.changed, 1);

    const row = await readSubscriber(pool, id);
    assert.equal(row.sms_status, "unsubscribed");
    assert.equal(row.email_status, "confirmed", "STOP means stop texting me, not stop everything");
    assert.equal(row.status, "confirmed", "a subscriber with a live email channel is still a subscriber");
    assert.equal(row.opted_out_at, null);

    // The outstanding SMS code is void: without this a rider could confirm a
    // channel they just stopped.
    const live = await pool.request().query<{ n: number }>(
      "SELECT COUNT(*) n FROM dbo.SubscriberConfirmations WHERE channel='sms' AND confirmed_at IS NULL AND superseded_at IS NULL",
    );
    assert.equal(live.recordset[0].n, 0);
    assert.equal((await inTx(pool, (tx) => confirmSms(tx, "+16125550142", "444444"))).outcome, "not_found");
  } finally {
    await pool.close();
  }
});

test("STOP on the only channel opts the record out, with a reason", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, { phone: "+16125550142", smsToken: "555555" });
    await inTx(pool, (tx) => confirmSms(tx, "+16125550142", "555555"));

    await inTx(pool, (tx) => optOut(tx, "sms", "+16125550142", "sms_stop"));
    const row = await readSubscriber(pool, id);
    assert.equal(row.status, "opted_out");
    assert.equal(row.opted_out_reason, "sms_stop");
    assert.ok(row.opted_out_at instanceof Date);

    // And no token may bring them back.
    await pool.request().input("id", sql.UniqueIdentifier, id).query(
      "INSERT dbo.SubscriberConfirmations (subscriber_id, channel, token, expires_at) VALUES (@id,'sms','666666',DATEADD(hour,24,SYSUTCDATETIME()))",
    );
    assert.equal((await inTx(pool, (tx) => confirmSms(tx, "+16125550142", "666666"))).outcome, "opted_out");
    assert.equal((await readSubscriber(pool, id)).status, "opted_out");
  } finally {
    await pool.close();
  }
});

test("STOP stops every record for that number, and repeating it is harmless", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // Duplicates are possible until increment 4 merges them; a STOP that
    // stopped only one of them would keep texting.
    const first = await seed(pool, { phone: "+16125550142", smsToken: "777777" });
    const second = await seed(pool, { phone: "+16125550142", smsToken: "888888" });

    const result = await inTx(pool, (tx) => optOut(tx, "sms", "+16125550142", "sms_stop"));
    assert.equal(result.changed, 2);
    for (const id of [first, second]) {
      assert.equal((await readSubscriber(pool, id)).sms_status, "unsubscribed");
    }

    // ACS relays STOP from any number, including one that never subscribed,
    // and a rider may send it twice. Neither is an error.
    assert.equal((await inTx(pool, (tx) => optOut(tx, "sms", "+16125550142", "sms_stop"))).changed, 0);
    assert.equal((await inTx(pool, (tx) => optOut(tx, "sms", "+15555550100", "sms_stop"))).changed, 0);
  } finally {
    await pool.close();
  }
});
