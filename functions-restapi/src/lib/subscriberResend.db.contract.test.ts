import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import {
  resendConfirmation,
  confirmSms,
  RESEND_COOLDOWN_MS,
  MAX_CONFIRM_ATTEMPTS,
} from "./subscriberConfirmation";

// Reissuing a token against a real SQL Server (the CI contract job's
// container). None of what is asserted here is visible to a test with fakes in
// it:
//
//   UX_SubConfirm_Channel_Token (migration 117) is unique over LIVE rows only.
//   The whole reason `resendConfirmation` supersedes before it issues is that
//   index, and an implementation that issued first would pass every unit test
//   and then fail against a six-digit code that collided with the row it was
//   about to retire. This is the same shape as the supersede-order defect that
//   made the manual-metric Change button answer 500 (1.5.184).
//
//   The subscriber lookup orders by a correlated subquery's select-list alias.
//   That is legal in T-SQL and not in every dialect, and it is what picks the
//   newest signup when a contact has duplicate rows.
//
//   The cooldown compares a DATETIME2 written by SYSUTCDATETIME() against a
//   Date from Node. Whether those are the same clock is a fact about the
//   driver, not about the code.
//
// Note on `--test-concurrency=1` in the contract npm script: this file and
// subscriberConfirmation.db.contract.test.ts both drop and recreate
// Subscribers and SubscriberConfirmations in the same database. Run in
// parallel, as node --test does by default, the two files deadlock each other
// on the reset - which is a fact about the test harness and not about anything
// under test. The contract job runs one file at a time.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

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
  smsStatus?: string | null;
  emailStatus?: string | null;
  status?: string;
  /** channel, token, and how long ago it was issued. */
  tokens?: { channel: "sms" | "email"; token: string; ageMinutes?: number; confirmed?: boolean; superseded?: boolean }[];
}

async function seed(pool: sql.ConnectionPool, s: Seed): Promise<string> {
  const id = (
    await pool
      .request()
      .input("phone", sql.NVarChar(20), s.phone ?? null)
      .input("email", sql.NVarChar(320), s.email ?? null)
      .input("sms", sql.NVarChar(30), s.smsStatus === undefined ? (s.phone ? "pending_confirmation" : null) : s.smsStatus)
      .input("em", sql.NVarChar(30), s.emailStatus === undefined ? (s.email ? "pending_confirmation" : null) : s.emailStatus)
      .input("status", sql.NVarChar(30), s.status ?? "pending_confirmation")
      .query<{ subscriber_id: string }>(
        `INSERT dbo.Subscribers (phone_number, email, categories, status, sms_status, email_status, consent_source)
         OUTPUT INSERTED.subscriber_id
         VALUES (@phone, @email, '["delay"]', @status, @sms, @em, 'web_form')`,
      )
  ).recordset[0].subscriber_id;

  for (const t of s.tokens ?? []) {
    await pool
      .request()
      .input("s", sql.UniqueIdentifier, id)
      .input("c", sql.NVarChar(10), t.channel)
      .input("t", sql.NVarChar(100), t.token)
      .input("age", sql.Int, t.ageMinutes ?? 0)
      .input("confirmed", sql.Bit, t.confirmed ? 1 : 0)
      .input("superseded", sql.Bit, t.superseded ? 1 : 0)
      .query(
        `INSERT dbo.SubscriberConfirmations (subscriber_id, channel, token, created_at, expires_at, confirmed_at, superseded_at)
         VALUES (@s, @c, @t,
                 DATEADD(minute, -@age, SYSUTCDATETIME()),
                 DATEADD(hour, 24, SYSUTCDATETIME()),
                 CASE WHEN @confirmed = 1 THEN SYSUTCDATETIME() END,
                 CASE WHEN @superseded = 1 THEN SYSUTCDATETIME() END)`,
      );
  }
  return id;
}

async function liveTokens(pool: sql.ConnectionPool, id: string, channel: string): Promise<string[]> {
  return (
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .input("c", sql.NVarChar(10), channel)
      .query<{ token: string }>(
        `SELECT token FROM dbo.SubscriberConfirmations
          WHERE subscriber_id=@id AND channel=@c AND confirmed_at IS NULL AND superseded_at IS NULL`,
      )
  ).recordset.map((r) => r.token);
}

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

/** Minutes that put a token safely outside the cooldown. */
const COOLED = Math.ceil(RESEND_COOLDOWN_MS / 60_000) + 1;

test("a resend leaves exactly one live token, and it is the new one", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, {
      phone: "+19523883275",
      tokens: [{ channel: "sms", token: "111111", ageMinutes: COOLED }],
    });

    const result = await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"));
    assert.equal(result.outcome, "issued");
    assert.equal(result.subscriberId, id);

    const live = await liveTokens(pool, id, "sms");
    assert.equal(live.length, 1, "two live codes would make the attempt cap dodgeable");
    assert.equal(live[0], result.issued!.token);
    assert.notEqual(live[0], "111111");
    assert.match(live[0], /^\d{6}$/);
  } finally {
    await pool.close();
  }
});

test("the superseded token is retired, not marked confirmed", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, {
      phone: "+19523883275",
      tokens: [{ channel: "sms", token: "222222", ageMinutes: COOLED }],
    });
    await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"));

    const old = (
      await pool.request().input("id", sql.UniqueIdentifier, id).query<{ confirmed_at: Date | null; superseded_at: Date | null }>(
        `SELECT confirmed_at, superseded_at FROM dbo.SubscriberConfirmations WHERE subscriber_id=@id AND token='222222'`,
      )
    ).recordset[0];
    assert.equal(old.confirmed_at, null, "a retired token must never read as a confirmation");
    assert.notEqual(old.superseded_at, null);
    // The channel is still unproven: reissuing a code proves nothing.
    const sub = (
      await pool.request().input("id", sql.UniqueIdentifier, id).query<{ sms_status: string }>(
        "SELECT sms_status FROM dbo.Subscribers WHERE subscriber_id=@id",
      )
    ).recordset[0];
    assert.equal(sub.sms_status, "pending_confirmation");
  } finally {
    await pool.close();
  }
});

test("a second resend inside the cooldown issues nothing", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, {
      phone: "+19523883275",
      tokens: [{ channel: "sms", token: "333333", ageMinutes: COOLED }],
    });
    const first = await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"));
    assert.equal(first.outcome, "issued");

    // The token just issued is seconds old, so the cooldown is what refuses.
    const second = await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"));
    assert.equal(second.outcome, "too_soon");
    assert.equal(second.issued, undefined);
    assert.deepEqual(await liveTokens(pool, id, "sms"), [first.issued!.token]);
  } finally {
    await pool.close();
  }
});

test("the cooldown is measured from the last token issued, spent or not", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // An old live token, and a recent one that was already superseded. Only
    // counting live rows would let a caller alternate resend and supersede to
    // keep sending.
    await seed(pool, {
      phone: "+19523883275",
      tokens: [
        { channel: "sms", token: "444444", ageMinutes: COOLED },
        { channel: "sms", token: "555555", ageMinutes: 0, superseded: true },
      ],
    });
    const result = await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"));
    assert.equal(result.outcome, "too_soon");
  } finally {
    await pool.close();
  }
});

test("a channel with no token yet is resent to", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // The publish after opt-in is best-effort; a rider whose first send never
    // happened has no token at all, and has to be able to ask for one.
    const id = await seed(pool, { phone: "+19523883275", tokens: [] });
    const result = await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"));
    assert.equal(result.outcome, "issued");
    assert.equal((await liveTokens(pool, id, "sms")).length, 1);
  } finally {
    await pool.close();
  }
});

test("a confirmed or unsubscribed channel is never resent to", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    await seed(pool, { phone: "+19523883275", smsStatus: "confirmed", status: "confirmed" });
    assert.equal(
      (await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"))).outcome,
      "nothing_to_send",
      "a confirmed channel has nothing left to prove",
    );

    await reset(pool);
    await seed(pool, { phone: "+16125550142", smsStatus: "unsubscribed", status: "opted_out" });
    assert.equal(
      (await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+16125550142"))).outcome,
      "nothing_to_send",
      "asking for a code must not revive an opt-out",
    );

    await reset(pool);
    await seed(pool, { phone: "+16125550143" });
    assert.equal(
      (await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+16125550199"))).outcome,
      "nothing_to_send",
      "a number nobody subscribed with",
    );
  } finally {
    await pool.close();
  }
});

test("resending one channel leaves the other channel's token alone", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, {
      phone: "+19523883275",
      email: "both@example.com",
      tokens: [
        { channel: "sms", token: "666666", ageMinutes: COOLED },
        { channel: "email", token: "email-token-live", ageMinutes: COOLED },
      ],
    });
    await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"));
    assert.deepEqual(await liveTokens(pool, id, "email"), ["email-token-live"]);
  } finally {
    await pool.close();
  }
});

test("a contact with duplicate rows gets one new token, on the newest signup", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // Duplicates are possible until they are merged on confirmation
    // (increment 4); resending to every one of them would send the rider three
    // texts for one request.
    const older = await seed(pool, {
      phone: "+19523883275",
      tokens: [{ channel: "sms", token: "777777", ageMinutes: 240 }],
    });
    const newer = await seed(pool, {
      phone: "+19523883275",
      tokens: [{ channel: "sms", token: "888888", ageMinutes: COOLED }],
    });

    const result = await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"));
    assert.equal(result.outcome, "issued");
    assert.equal(result.subscriberId, newer, "the newest signup is the one the rider is waiting on");
    assert.deepEqual(await liveTokens(pool, older, "sms"), ["777777"]);
    assert.equal((await liveTokens(pool, newer, "sms")).length, 1);
  } finally {
    await pool.close();
  }
});

test("a new code may reuse a code the supersede just freed", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // UX_SubConfirm_Channel_Token covers live rows only. Superseding first is
    // what frees the entry; issuing first would meet the index still holding
    // the token being retired.
    const id = await seed(pool, {
      phone: "+19523883275",
      tokens: [{ channel: "sms", token: "999999", ageMinutes: COOLED }],
    });
    const result = await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"));
    assert.equal(result.outcome, "issued");

    // Prove the freed entry is genuinely reusable, which is the property the
    // ordering buys: insert the retired code again as a live row. (Skipped in
    // the one-in-a-million case where the redraw happened to land on it, which
    // would make the insert a duplicate for an honest reason.)
    if (result.issued!.token === "999999") return;
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query(
        `INSERT dbo.SubscriberConfirmations (subscriber_id, channel, token, expires_at)
         VALUES (@id, 'sms', '999999', DATEADD(hour, 24, SYSUTCDATETIME()))`,
      );
    assert.equal((await liveTokens(pool, id, "sms")).includes("999999"), true);
  } finally {
    await pool.close();
  }
});

// What happens to the text the resend replaced. A rider now holds two, the
// older one still looks current, and which of them they type is not a
// meaningful choice they made.

async function attemptsOnLiveToken(pool: sql.ConnectionPool, id: string): Promise<number> {
  const result = await pool.request().input("id", sql.UniqueIdentifier, id).query<{ attempts: number }>(
    `SELECT attempts FROM dbo.SubscriberConfirmations
      WHERE subscriber_id=@id AND channel='sms' AND confirmed_at IS NULL AND superseded_at IS NULL`,
  );
  return result.recordset[0].attempts;
}

test("the code a resend replaced says so, and does not cost an attempt", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, {
      phone: "+19523883275",
      tokens: [{ channel: "sms", token: "111111", ageMinutes: COOLED }],
    });
    assert.equal((await inTx(pool, (tx) => resendConfirmation(tx, "sms", "+19523883275"))).outcome, "issued");

    // The older text. Treating it as a wrong guess both misdescribes it - we
    // sent that code to this number - and spends one of the five tries on a
    // mistake the rider had no way to avoid making.
    const stale = await inTx(pool, (tx) => confirmSms(tx, "+19523883275", "111111"));
    assert.equal(stale.outcome, "superseded", "tell the rider to use the newer code, not that theirs is wrong");
    assert.equal(await attemptsOnLiveToken(pool, id), 0, "a code we really sent is not a guess");

    // The newer one still works, and was not damaged by the attempt above.
    const live = (await liveTokens(pool, id, "sms"))[0];
    assert.equal((await inTx(pool, (tx) => confirmSms(tx, "+19523883275", live))).outcome, "confirmed");
  } finally {
    await pool.close();
  }
});

test("a code we never sent to this number is still a guess", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, {
      phone: "+19523883275",
      tokens: [
        { channel: "sms", token: "222222", ageMinutes: COOLED, superseded: true },
        { channel: "sms", token: "333333" },
      ],
    });

    // The concession is narrow on purpose: it applies only to codes this
    // number was actually issued. Reaching it means naming one of those, which
    // is exactly as hard as naming the live code - so it hands a guesser
    // nothing, and everything else still counts.
    const guess = await inTx(pool, (tx) => confirmSms(tx, "+19523883275", "000000"));
    assert.equal(guess.outcome, "incorrect_code");
    assert.equal(guess.attemptsRemaining, MAX_CONFIRM_ATTEMPTS - 1);
    assert.equal(await attemptsOnLiveToken(pool, id), 1);

    // And another number's retired code is not "ours" either.
    await seed(pool, {
      phone: "+16125550142",
      tokens: [{ channel: "sms", token: "444444", superseded: true }, { channel: "sms", token: "555555" }],
    });
    const crossed = await inTx(pool, (tx) => confirmSms(tx, "+19523883275", "444444"));
    assert.equal(crossed.outcome, "incorrect_code");
    assert.equal(await attemptsOnLiveToken(pool, id), 2);
  } finally {
    await pool.close();
  }
});

test("replying with the code that already worked reads as done", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // A confirmed channel with a later pending one is unusual but reachable:
    // the rider re-subscribed. Their old code should not read as a wrong
    // guess against the new signup.
    const id = await seed(pool, {
      phone: "+19523883275",
      tokens: [
        { channel: "sms", token: "666666", confirmed: true },
        { channel: "sms", token: "777777" },
      ],
    });
    const spent = await inTx(pool, (tx) => confirmSms(tx, "+19523883275", "666666"));
    assert.equal(spent.outcome, "already_confirmed");
    assert.equal(await attemptsOnLiveToken(pool, id), 0);
  } finally {
    await pool.close();
  }
});
