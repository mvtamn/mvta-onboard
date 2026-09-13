import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import { makeManageKey } from "./manageKey";
import { requestManageLink, MANAGE_LINK_MIN_INTERVAL_MS } from "./subscriberPreferences";

// Sending a rider their manage link again, against a real SQL Server (the CI
// contract job's container). What only a database can answer:
//
//   That the lookup finds a CONFIRMED channel and nothing else. The manage key
//   opens the whole subscription, so the difference between "confirmed" and
//   "typed into a form by somebody" is the difference between returning a
//   rider's link and handing a stranger's subscription to whoever owns an
//   inbox.
//
//   That the throttle is stored, so it holds across requests and restarts.
//
//   That an UPDATE which issues a missing key and stamps the send in one
//   statement leaves the key it returned in the row - SET expressions read the
//   pre-update row, which is what makes COALESCE and the CASE agree.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const MIGRATIONS = [
  "migration-117-subscriber-channel-state.sql",
  "migration-118-subscriber-merge.sql",
  "migration-119-subscriber-manage-key.sql",
  "migration-120-subscriber-manage-link-sent.sql",
];

const BEFORE = `
IF OBJECT_ID('dbo.SubscriberPreferenceChanges','U') IS NOT NULL DROP TABLE dbo.SubscriberPreferenceChanges;
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

async function applyAll(pool: sql.ConnectionPool) {
  for (const file of MIGRATIONS) {
    const text = readFileSync(join(process.cwd(), "sql", file), "utf8");
    for (const batch of text.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) {
      await pool.request().batch(batch);
    }
  }
}

async function reset(pool: sql.ConnectionPool) {
  await pool.request().batch(BEFORE);
  await applyAll(pool);
}

// Every contract file shares one database and rebuilds its tables by dropping
// them. SubscriberPreferenceChanges (created by migration 119) holds a foreign
// key to Subscribers, so leaving it behind breaks the next file's DROP with a
// message that names the wrong cause.
after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try {
    await pool.request().batch("IF OBJECT_ID('dbo.SubscriberPreferenceChanges','U') IS NOT NULL DROP TABLE dbo.SubscriberPreferenceChanges;");
  } finally {
    await pool.close();
  }
});

interface Seed {
  phone?: string | null;
  email?: string | null;
  status?: string;
  sms?: string | null;
  em?: string | null;
  key?: string | null;
}

async function seed(pool: sql.ConnectionPool, s: Seed): Promise<string> {
  return (
    await pool
      .request()
      .input("phone", sql.NVarChar(20), s.phone ?? null)
      .input("email", sql.NVarChar(320), s.email ?? null)
      .input("status", sql.NVarChar(30), s.status ?? "confirmed")
      .input("sms", sql.NVarChar(30), s.sms === undefined ? (s.phone ? "confirmed" : null) : s.sms)
      .input("em", sql.NVarChar(30), s.em === undefined ? (s.email ? "confirmed" : null) : s.em)
      .input("key", sql.NVarChar(64), s.key === undefined ? makeManageKey() : s.key)
      .query<{ subscriber_id: string }>(
        `INSERT dbo.Subscribers (phone_number, email, categories, status, sms_status, email_status, consent_source, manage_key, manage_key_issued_at, opted_in_at)
         OUTPUT INSERTED.subscriber_id
         VALUES (@phone, @email, '["delay"]', @status, @sms, @em, 'web_form', @key, CASE WHEN @key IS NULL THEN NULL ELSE SYSUTCDATETIME() END, SYSUTCDATETIME())`,
      )
  ).recordset[0].subscriber_id;
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

async function row(pool: sql.ConnectionPool, id: string) {
  return (
    await pool.request().input("id", sql.UniqueIdentifier, id).query<{
      manage_key: string | null; manage_key_issued_at: Date | null; manage_link_sent_at: Date | null;
    }>("SELECT manage_key, manage_key_issued_at, manage_link_sent_at FROM dbo.Subscribers WHERE subscriber_id=@id")
  ).recordset[0];
}

const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };

test("migration 120 is re-runnable and adds the column", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    await applyAll(pool);
    const col = await pool.request().query<{ n: number }>(
      "SELECT COUNT(*) n FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Subscribers') AND name = 'manage_link_sent_at'",
    );
    assert.equal(col.recordset[0].n, 1);
  } finally {
    await pool.close();
  }
});

test("a confirmed channel is sent its link, and only its own contact travels", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const key = makeManageKey();
    const id = await seed(pool, { phone: "+16125550123", email: "both@example.com", key });

    const result = await inTx(pool, (tx) => requestManageLink(tx, "sms", "+16125550123"));
    assert.equal(result.outcome, "issued");
    assert.deepEqual(result.event, {
      kind: "manage_link",
      subscriber_id: id,
      channel: "sms",
      manage_key: key,
      phone_number: "+16125550123",
      // The other contact is none of this message's business.
      email: null,
    });
    assert.ok((await row(pool, id)).manage_link_sent_at instanceof Date, "the send is stamped for the throttle");
  } finally {
    await pool.close();
  }
});

test("nothing is sent to a contact nobody has proved, or to a record that is gone", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    // Typed into a form, never confirmed.
    await seed(pool, { phone: "+16125550100", status: "pending_confirmation", sms: "pending_confirmation" });
    // Confirmed once, then opted out.
    await seed(pool, { phone: "+16125550101", status: "opted_out", sms: "unsubscribed" });
    // Folded into another record.
    const survivor = await seed(pool, { phone: "+16125550199" });
    const folded = await seed(pool, { phone: "+16125550102" });
    await pool.request().input("l", sql.UniqueIdentifier, folded).input("w", sql.UniqueIdentifier, survivor).query(
      "UPDATE dbo.Subscribers SET status='merged', merged_into=@w, merged_at=SYSUTCDATETIME() WHERE subscriber_id=@l",
    );

    for (const phone of ["+16125550100", "+16125550101", "+16125550102", "+15555550000"]) {
      const result = await inTx(pool, (tx) => requestManageLink(tx, "sms", phone));
      assert.equal(result.outcome, "nothing_confirmed", phone);
      assert.equal(result.event, undefined, `${phone}: no event means nothing is published`);
    }
  } finally {
    await pool.close();
  }
});

test("proof is per channel: a confirmed email does not vouch for an unconfirmed phone", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    await seed(pool, { phone: "+16125550123", email: "rider@example.com", sms: "pending_confirmation", em: "confirmed" });
    assert.equal((await inTx(pool, (tx) => requestManageLink(tx, "sms", "+16125550123"))).outcome, "nothing_confirmed");
    const email = await inTx(pool, (tx) => requestManageLink(tx, "email", "rider@example.com"));
    assert.equal(email.outcome, "issued");
    assert.equal(email.event?.phone_number, null, "the unproven phone is not carried along");
  } finally {
    await pool.close();
  }
});

test("a second request inside two minutes sends nothing, and one after it does", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    await seed(pool, { email: "rider@example.com" });
    const first = new Date();
    assert.equal((await inTx(pool, (tx) => requestManageLink(tx, "email", "rider@example.com", first))).outcome, "issued");
    // Without this, the endpoint is a way to email somebody on demand.
    const soon = new Date(first.getTime() + MANAGE_LINK_MIN_INTERVAL_MS - 1000);
    assert.equal((await inTx(pool, (tx) => requestManageLink(tx, "email", "rider@example.com", soon))).outcome, "too_soon");
    const later = new Date(first.getTime() + MANAGE_LINK_MIN_INTERVAL_MS + 1000);
    assert.equal((await inTx(pool, (tx) => requestManageLink(tx, "email", "rider@example.com", later))).outcome, "issued");
  } finally {
    await pool.close();
  }
});

test("a record with no key is issued one, and the link sent is the key stored", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const id = await seed(pool, { email: "old@example.com", key: null });
    const result = await inTx(pool, (tx) => requestManageLink(tx, "email", "old@example.com"));
    assert.equal(result.outcome, "issued");
    const stored = await row(pool, id);
    assert.ok(stored.manage_key, "a key was issued");
    assert.equal(result.event?.manage_key, stored.manage_key, "the link would open the subscription it was sent for");
    assert.ok(stored.manage_key_issued_at instanceof Date);

    // And an existing key is never replaced by a request for it.
    const again = await inTx(pool, (tx) =>
      requestManageLink(tx, "email", "old@example.com", new Date(Date.now() + MANAGE_LINK_MIN_INTERVAL_MS + 1000)),
    );
    assert.equal(again.event?.manage_key, stored.manage_key);
    assert.equal((await row(pool, id)).manage_key, stored.manage_key);
  } finally {
    await pool.close();
  }
});
