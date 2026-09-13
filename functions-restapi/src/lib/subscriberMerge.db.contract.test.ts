import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import { confirmEmail, confirmSms, optOut, resendConfirmation } from "./subscriberConfirmation";

// Merging duplicate records on confirmation, against a real SQL Server.
//
// This is the increment that most needs a database under it. `unionAudience`
// is a pure function with its own tests; everything else here is constraints
// and statement order:
//
//   CK_Subscribers_MergedInto (migration 118) makes 'merged' and a NULL
//   survivor mutually exclusive. Any path that sets one without the other -
//   an opt-out landing on a merged record, most obviously - fails at COMMIT
//   and takes an unrelated rider's STOP down with it.
//
//   Repointing a live confirmation to the survivor is what keeps a link
//   already sitting in an inbox working. Whether the repointed token then
//   confirms the survivor is a fact about the join, not about the intent.
//
//   Every audience query selects status = 'confirmed', so a merged record
//   leaves the audience for free. That is only true if merging actually writes
//   that status, which is a thing to assert rather than assume.
//
// See subscriberResend.db.contract.test.ts on why the contract job runs one
// file at a time: this file resets the same two tables.
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
  for (const file of [
    "migration-117-subscriber-channel-state.sql",
    "migration-118-subscriber-merge.sql",
  ]) {
    const text = readFileSync(join(process.cwd(), "sql", file), "utf8");
    for (const batch of text.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) {
      await pool.request().batch(batch);
    }
  }
}

interface Seed {
  phone?: string | null;
  email?: string | null;
  smsStatus?: string | null;
  emailStatus?: string | null;
  status?: string;
  categories?: string;
  routes?: string | null;
  zones?: string | null;
  /** Hours ago this record's consent was recorded; omitted means never. */
  optedInHoursAgo?: number;
  tokens?: { channel: "sms" | "email"; token: string }[];
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
      .input("categories", sql.NVarChar, s.categories ?? '["delay"]')
      .input("routes", sql.NVarChar, s.routes ?? null)
      .input("zones", sql.NVarChar, s.zones ?? null)
      .input("optedIn", sql.Int, s.optedInHoursAgo ?? null)
      .query<{ subscriber_id: string }>(
        `INSERT dbo.Subscribers (phone_number, email, categories, routes, zones, status, sms_status, email_status, consent_source, opted_in_at)
         OUTPUT INSERTED.subscriber_id
         VALUES (@phone, @email, @categories, @routes, @zones, @status, @sms, @em, 'web_form',
                 CASE WHEN @optedIn IS NULL THEN NULL ELSE DATEADD(hour, -@optedIn, SYSUTCDATETIME()) END)`,
      )
  ).recordset[0].subscriber_id;

  for (const t of s.tokens ?? []) {
    await pool
      .request()
      .input("s", sql.UniqueIdentifier, id)
      .input("c", sql.NVarChar(10), t.channel)
      .input("t", sql.NVarChar(100), t.token)
      .query(
        `INSERT dbo.SubscriberConfirmations (subscriber_id, channel, token, expires_at)
         VALUES (@s, @c, @t, DATEADD(hour, 24, SYSUTCDATETIME()))`,
      );
  }
  return id;
}

interface Row {
  subscriber_id: string;
  phone_number: string | null;
  email: string | null;
  routes: string | null;
  zones: string | null;
  categories: string;
  status: string;
  sms_status: string | null;
  email_status: string | null;
  merged_into: string | null;
  opted_in_at: Date | null;
}

async function read(pool: sql.ConnectionPool, id: string): Promise<Row> {
  return (
    await pool.request().input("id", sql.UniqueIdentifier, id).query<Row>(
      `SELECT subscriber_id, phone_number, email, routes, zones, categories, status,
              sms_status, email_status, merged_into, opted_in_at
         FROM dbo.Subscribers WHERE subscriber_id = @id`,
    )
  ).recordset[0];
}

/** What a dispatch would actually send to for this contact. */
async function audienceFor(pool: sql.ConnectionPool, phone: string): Promise<string[]> {
  return (
    await pool.request().input("p", sql.NVarChar(20), phone).query<{ subscriber_id: string }>(
      `SELECT subscriber_id FROM dbo.Subscribers
        WHERE phone_number = @p AND status = 'confirmed' AND sms_status = 'confirmed'`,
    )
  ).recordset.map((r) => r.subscriber_id);
}

async function liveTokenOwner(pool: sql.ConnectionPool, token: string): Promise<{ subscriber_id: string; superseded: boolean } | null> {
  const row = (
    await pool.request().input("t", sql.NVarChar(100), token).query<{ subscriber_id: string; superseded_at: Date | null }>(
      `SELECT subscriber_id, superseded_at FROM dbo.SubscriberConfirmations WHERE token = @t`,
    )
  ).recordset[0];
  return row ? { subscriber_id: row.subscriber_id, superseded: row.superseded_at !== null } : null;
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
const PHONE = "+16125550123";

test("confirming a duplicate folds it into the record that was already confirmed", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const established = await seed(pool, {
      phone: PHONE,
      smsStatus: "confirmed",
      status: "confirmed",
      optedInHoursAgo: 500,
      categories: '["delay"]',
      routes: '["444"]',
    });
    const newcomer = await seed(pool, {
      phone: PHONE,
      categories: '["detour","delay"]',
      routes: '["445"]',
      tokens: [{ channel: "sms", token: "123456" }],
    });

    const result = await inTx(pool, (tx) => confirmSms(tx, PHONE, "123456"));
    assert.equal(result.outcome, "confirmed");
    // The survivor is reported, not the record that was confirming.
    assert.equal(result.subscriberId, established);

    const survivor = await read(pool, established);
    const folded = await read(pool, newcomer);
    assert.equal(folded.status, "merged");
    assert.equal(folded.merged_into, established);
    // Both lists were chosen by the same proven person; neither is discarded.
    assert.deepEqual(JSON.parse(survivor.categories).sort(), ["delay", "detour"]);
    assert.deepEqual(JSON.parse(survivor.routes!).sort(), ["444", "445"]);
    // The established record keeps the date its consent rests on.
    assert.ok(survivor.opted_in_at! < folded.opted_in_at!);

    assert.deepEqual(await audienceFor(pool, PHONE), [established], "one rider, one send");
  } finally {
    await pool.close();
  }
});

test("a record that opted out is never the survivor", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // Stopped alerts, then subscribed again later. The new consent is the
    // live one; folding it into the stopped record would discard it.
    const stopped = await seed(pool, {
      phone: PHONE,
      smsStatus: "confirmed",
      status: "opted_out",
      optedInHoursAgo: 500,
    });
    const fresh = await seed(pool, { phone: PHONE, tokens: [{ channel: "sms", token: "222222" }] });

    const result = await inTx(pool, (tx) => confirmSms(tx, PHONE, "222222"));
    assert.equal(result.subscriberId, fresh);
    assert.equal((await read(pool, stopped)).status, "opted_out", "untouched");
    assert.equal((await read(pool, fresh)).status, "confirmed");
  } finally {
    await pool.close();
  }
});

test("a contact moves into an empty slot, and the link already sent still works", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const established = await seed(pool, {
      phone: PHONE,
      smsStatus: "confirmed",
      status: "confirmed",
      optedInHoursAgo: 500,
    });
    // Signed up again with the same number AND an email, and confirms the
    // number. The email is unproven, but it is a channel the rider asked for.
    const newcomer = await seed(pool, {
      phone: PHONE,
      email: "rider@example.com",
      tokens: [
        { channel: "sms", token: "333333" },
        { channel: "email", token: "email-token-live" },
      ],
    });

    await inTx(pool, (tx) => confirmSms(tx, PHONE, "333333"));

    const survivor = await read(pool, established);
    assert.equal(survivor.email, "rider@example.com");
    assert.equal(survivor.email_status, "pending_confirmation", "carried across unproven");
    assert.equal((await read(pool, newcomer)).status, "merged");

    // The token travelled with the address, so the link in the inbox confirms
    // the survivor rather than a record that no longer exists to the rider.
    const owner = await liveTokenOwner(pool, "email-token-live");
    assert.deepEqual(owner, { subscriber_id: established, superseded: false });

    const confirmed = await inTx(pool, (tx) => confirmEmail(tx, "email-token-live"));
    assert.equal(confirmed.outcome, "confirmed");
    assert.equal(confirmed.subscriberId, established);
    assert.equal((await read(pool, established)).email_status, "confirmed");
  } finally {
    await pool.close();
  }
});

test("where both records hold a contact, the established one stands", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // Overwriting a proven address with an unproven one is the single move in
    // this whole increment that could send to a stranger.
    const established = await seed(pool, {
      phone: PHONE,
      email: "proven@example.com",
      emailStatus: "confirmed",
      smsStatus: "confirmed",
      status: "confirmed",
      optedInHoursAgo: 500,
    });
    const newcomer = await seed(pool, {
      phone: PHONE,
      email: "someone-else@example.com",
      tokens: [
        { channel: "sms", token: "444444" },
        { channel: "email", token: "other-email-token" },
      ],
    });

    await inTx(pool, (tx) => confirmSms(tx, PHONE, "444444"));

    assert.equal((await read(pool, established)).email, "proven@example.com");
    assert.equal((await read(pool, newcomer)).status, "merged");
    // And the unproven address's token is dead, not repointed.
    assert.deepEqual(await liveTokenOwner(pool, "other-email-token"), {
      subscriber_id: newcomer,
      superseded: true,
    });
    assert.equal((await inTx(pool, (tx) => confirmEmail(tx, "other-email-token"))).outcome, "superseded");
  } finally {
    await pool.close();
  }
});

test("with no confirmed duplicate, the record in hand survives and the unconfirmed ones fold in", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const abandoned = await seed(pool, {
      phone: PHONE,
      categories: '["closure"]',
      tokens: [{ channel: "sms", token: "555555" }],
    });
    const confirming = await seed(pool, {
      phone: PHONE,
      categories: '["delay"]',
      tokens: [{ channel: "sms", token: "666666" }],
    });

    const result = await inTx(pool, (tx) => confirmSms(tx, PHONE, "666666"));
    assert.equal(result.subscriberId, confirming);

    const folded = await read(pool, abandoned);
    assert.equal(folded.status, "merged");
    assert.equal(folded.merged_into, confirming);
    // Nobody proved the abandoned record's choices, so they do not travel.
    assert.deepEqual(JSON.parse((await read(pool, confirming)).categories), ["delay"]);
    // Its outstanding code is dead; confirming it would revive a merged record.
    assert.equal((await liveTokenOwner(pool, "555555"))!.superseded, true);
    assert.equal((await inTx(pool, (tx) => confirmSms(tx, PHONE, "555555"))).outcome, "already_confirmed");
    assert.deepEqual(await audienceFor(pool, PHONE), [confirming]);
  } finally {
    await pool.close();
  }
});

test("a record confirmed on its other channel is kept, but loses its claim on this contact", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // A real subscription - it gets emails - that also carries an unproven
    // copy of somebody's phone number. Folding it away would cancel email the
    // rider confirmed; leaving its code live would let one number be confirmed
    // twice, which is the double-send this increment exists to prevent.
    const emailer = await seed(pool, {
      phone: PHONE,
      email: "emailer@example.com",
      emailStatus: "confirmed",
      status: "confirmed",
      optedInHoursAgo: 500,
      tokens: [{ channel: "sms", token: "777777" }],
    });
    const confirming = await seed(pool, { phone: PHONE, tokens: [{ channel: "sms", token: "888888" }] });

    await inTx(pool, (tx) => confirmSms(tx, PHONE, "888888"));

    const kept = await read(pool, emailer);
    assert.equal(kept.status, "confirmed", "an email subscription the rider proved");
    assert.equal(kept.merged_into, null);
    assert.equal((await liveTokenOwner(pool, "777777"))!.superseded, true);
    assert.deepEqual(await audienceFor(pool, PHONE), [confirming]);
  } finally {
    await pool.close();
  }
});

test("STOP after a merge does not fail on the merged record", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // optOut stops every record holding the contact. A merged one cannot be
    // moved to 'opted_out' - CK_Subscribers_MergedInto forbids the pair - so
    // an unfiltered update would abort the whole STOP at COMMIT.
    const established = await seed(pool, {
      phone: PHONE,
      smsStatus: "confirmed",
      status: "confirmed",
      optedInHoursAgo: 500,
    });
    const newcomer = await seed(pool, { phone: PHONE, tokens: [{ channel: "sms", token: "999999" }] });
    await inTx(pool, (tx) => confirmSms(tx, PHONE, "999999"));

    const result = await inTx(pool, (tx) => optOut(tx, "sms", PHONE, "sms_stop"));
    assert.equal(result.changed, 1, "the survivor, and only the survivor");
    assert.equal((await read(pool, established)).status, "opted_out");
    assert.equal((await read(pool, newcomer)).status, "merged", "still merged, not opted out");
    assert.deepEqual(await audienceFor(pool, PHONE), []);
  } finally {
    await pool.close();
  }
});

test("a resend is never issued against a merged record", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // The merged record keeps email_status = 'pending_confirmation' as
    // history. Reissuing against it would text or email a code that confirms a
    // record no audience query can see.
    const established = await seed(pool, {
      phone: PHONE,
      email: "proven@example.com",
      emailStatus: "confirmed",
      smsStatus: "confirmed",
      status: "confirmed",
      optedInHoursAgo: 500,
    });
    const newcomer = await seed(pool, {
      phone: PHONE,
      email: "someone-else@example.com",
      tokens: [{ channel: "sms", token: "101010" }],
    });
    await inTx(pool, (tx) => confirmSms(tx, PHONE, "101010"));
    assert.equal((await read(pool, newcomer)).status, "merged");

    const result = await inTx(pool, (tx) => resendConfirmation(tx, "email", "someone-else@example.com"));
    assert.equal(result.outcome, "nothing_to_send");
    assert.equal(result.issued, undefined);
    assert.equal((await read(pool, established)).email, "proven@example.com");
  } finally {
    await pool.close();
  }
});

test("confirming a contact nobody else holds changes nothing", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const only = await seed(pool, { phone: PHONE, tokens: [{ channel: "sms", token: "111222" }] });
    const result = await inTx(pool, (tx) => confirmSms(tx, PHONE, "111222"));
    assert.equal(result.subscriberId, only);
    const row = await read(pool, only);
    assert.equal(row.status, "confirmed");
    assert.equal(row.merged_into, null);
  } finally {
    await pool.close();
  }
});

test("three records holding one contact resolve in a single confirmation", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const established = await seed(pool, {
      phone: PHONE,
      smsStatus: "confirmed",
      status: "confirmed",
      optedInHoursAgo: 500,
      categories: '["delay"]',
    });
    const abandoned = await seed(pool, { phone: PHONE, categories: '["closure"]' });
    const confirming = await seed(pool, {
      phone: PHONE,
      categories: '["detour"]',
      tokens: [{ channel: "sms", token: "121212" }],
    });

    const result = await inTx(pool, (tx) => confirmSms(tx, PHONE, "121212"));
    assert.equal(result.subscriberId, established);
    assert.equal((await read(pool, abandoned)).merged_into, established, "not left for later");
    assert.equal((await read(pool, confirming)).merged_into, established);
    assert.deepEqual(await audienceFor(pool, PHONE), [established]);
    // Two folds into one survivor. The second must union onto the result of
    // the first, not onto the row as it was before either ran - otherwise the
    // confirming record's own choice is written over by the abandoned one's.
    // (The abandoned record was never confirmed, so only its fold is dropped;
    // what must survive is the confirming record's "detour".)
    const survivor = await read(pool, established);
    assert.deepEqual(JSON.parse(survivor.categories).sort(), ["delay", "detour"]);
  } finally {
    await pool.close();
  }
});
