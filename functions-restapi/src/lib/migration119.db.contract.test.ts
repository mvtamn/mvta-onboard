import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import { isManageKey, makeManageKey } from "./manageKey";

// Migration 119 against a real SQL Server (the CI contract job's container).
//
// One assumption in it is load-bearing and invisible to any other kind of test:
// the backfill generates a key per row with CRYPT_GEN_RANDOM. If SQL Server
// evaluated that once per statement - the way RAND() is evaluated once per
// statement - every subscriber would receive the SAME manage key, and one
// rider's link would manage everyone's subscription. The unique index is what
// makes that loud rather than silent, but "the index would have refused to
// build" is a claim about SQL Server too, so both are checked here against
// several rows.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const MIGRATIONS = [
  "migration-117-subscriber-channel-state.sql",
  "migration-118-subscriber-merge.sql",
  "migration-119-subscriber-manage-key.sql",
];

async function apply(pool: sql.ConnectionPool, file: string) {
  const text = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

// The pre-117 shape, so 119 is exercised on top of the same stack it will meet.
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

const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };

// Every contract test file shares one database, and each rebuilds the tables it
// needs by dropping them first. SubscriberPreferenceChanges holds a foreign key
// to Subscribers, so a file that leaves it behind makes the NEXT file's
// `DROP TABLE dbo.Subscribers` fail - and that file then reports "there is
// already an object named 'Subscribers'", which says nothing about the file
// that actually caused it. This one is the only file that creates the table, so
// it is the one that has to take it away again.
after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try {
    await pool.request().batch("IF OBJECT_ID('dbo.SubscriberPreferenceChanges','U') IS NOT NULL DROP TABLE dbo.SubscriberPreferenceChanges;");
  } finally {
    await pool.close();
  }
});

test("migration 119 gives every existing subscriber their own key", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(BEFORE);
    await apply(pool, MIGRATIONS[0]);
    await apply(pool, MIGRATIONS[1]);

    // Several rows, in the states the backfill has to cover. The merged one
    // matters: its key still has to exist, because a link mailed before the
    // merge is in somebody's inbox and increment B resolves it to the survivor.
    await pool.request().batch(`
      INSERT dbo.Subscribers (phone_number, email, categories, status, sms_status, email_status, consent_source) VALUES
        ('+16125550123', NULL, '["delay"]', 'pending_confirmation', 'pending_confirmation', NULL, 'web_form'),
        ('+16125550142', 'a@example.com', '["delay"]', 'confirmed', 'confirmed', 'confirmed', 'web_form'),
        ('+16125550143', NULL, '["delay"]', 'opted_out', 'unsubscribed', NULL, 'web_form'),
        (NULL, 'b@example.com', '["delay"]', 'confirmed', NULL, 'confirmed', 'web_form');
      UPDATE TOP (1) dbo.Subscribers
         SET merged_into = (SELECT TOP 1 subscriber_id FROM dbo.Subscribers WHERE email = 'a@example.com'),
             merged_at = SYSUTCDATETIME(), status = 'merged'
       WHERE email = 'b@example.com';`);

    await apply(pool, MIGRATIONS[2]);
    // Declared re-runnable, which for this one is a promise about an UPDATE
    // guarded by "WHERE manage_key IS NULL". A second run must not reissue -
    // that would invalidate every link already in an inbox.
    const before = await pool.request().query<{ manage_key: string }>("SELECT manage_key FROM dbo.Subscribers ORDER BY subscriber_id");
    await apply(pool, MIGRATIONS[2]);
    const after = await pool.request().query<{ manage_key: string }>("SELECT manage_key FROM dbo.Subscribers ORDER BY subscriber_id");
    assert.deepEqual(
      after.recordset.map((r) => r.manage_key),
      before.recordset.map((r) => r.manage_key),
      "re-running must not reissue keys; every link already sent would stop working",
    );

    const keys = after.recordset.map((r) => r.manage_key);
    assert.equal(keys.length, 4, "every row, including the merged and opted-out ones");
    for (const key of keys) {
      assert.ok(key, "no subscriber may be left without a key - they could not unsubscribe");
      assert.ok(
        isManageKey(key.toLowerCase()),
        `backfilled key ${JSON.stringify(key)} must be the 64 hex characters the application also produces`,
      );
    }
    assert.equal(
      new Set(keys.map((k) => k.toLowerCase())).size,
      4,
      "keys must be distinct - CRYPT_GEN_RANDOM evaluated once per statement instead of once per row would hand every rider the same link",
    );
  } finally {
    await pool.close();
  }
});

test("a key cannot be shared between two subscribers", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(BEFORE);
    for (const file of MIGRATIONS) await apply(pool, file);

    const key = makeManageKey();
    await pool.request().input("k", sql.NVarChar(64), key).query(
      `INSERT dbo.Subscribers (phone_number, categories, status, sms_status, consent_source, manage_key, manage_key_issued_at)
       VALUES ('+16125550123', '["delay"]', 'pending_confirmation', 'pending_confirmation', 'web_form', @k, SYSUTCDATETIME())`,
    );
    await assert.rejects(
      pool.request().input("k", sql.NVarChar(64), key).query(
        `INSERT dbo.Subscribers (phone_number, categories, status, sms_status, consent_source, manage_key, manage_key_issued_at)
         VALUES ('+16125550142', '["delay"]', 'pending_confirmation', 'pending_confirmation', 'web_form', @k, SYSUTCDATETIME())`,
      ),
      /duplicate key|UX_Subscribers_ManageKey/i,
      "two subscribers sharing a key means one rider's link manages the other's subscription",
    );

    // The index is filtered, so rows without a key yet are not "the same key".
    for (const phone of ["+16125550150", "+16125550151"]) {
      await pool.request().input("p", sql.NVarChar(20), phone).query(
        `INSERT dbo.Subscribers (phone_number, categories, status, sms_status, consent_source)
         VALUES (@p, '["delay"]', 'pending_confirmation', 'pending_confirmation', 'web_form')`,
      );
    }
  } finally {
    await pool.close();
  }
});

test("a preference change records what it changed, and cannot record nonsense", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(BEFORE);
    for (const file of MIGRATIONS) await apply(pool, file);

    const id = (
      await pool.request().query<{ subscriber_id: string }>(
        `INSERT dbo.Subscribers (phone_number, categories, status, sms_status, consent_source, manage_key, manage_key_issued_at)
         OUTPUT INSERTED.subscriber_id
         VALUES ('+16125550123', '["delay"]', 'confirmed', 'confirmed', 'web_form', LOWER(CONVERT(NVARCHAR(64), CRYPT_GEN_RANDOM(32), 2)), SYSUTCDATETIME())`,
      )
    ).recordset[0].subscriber_id;

    const write = (source: string, before: string | null, after: string) =>
      pool
        .request()
        .input("s", sql.UniqueIdentifier, id)
        .input("src", sql.NVarChar(20), source)
        .input("b", sql.NVarChar(sql.MAX), before)
        .input("a", sql.NVarChar(sql.MAX), after)
        .query("INSERT dbo.SubscriberPreferenceChanges (subscriber_id, source, before_state, after_state) VALUES (@s, @src, @b, @a)");

    // The scenario the table exists for: "I unsubscribed and kept getting
    // texts." A row with a date on it is the only answer to that.
    await write("rider_page", '{"routes":"ALL"}', '{"routes":["470","472"]}');
    await write("sms_stop", '{"sms_status":"confirmed"}', '{"sms_status":"unsubscribed"}');
    await write("staff", null, '{"categories":["delay"]}');

    await assert.rejects(
      write("api", null, "{}"),
      /CK_SubscriberPreferenceChanges_Source|conflicted/i,
      "the source must name who made the change, not which endpoint served it",
    );
    // Malformed JSON is only ever discovered while someone is trying to answer
    // a complaint, which is the worst possible moment to discover it.
    await assert.rejects(
      write("rider_page", null, "not json"),
      /CK_SubscriberPreferenceChanges_AfterJson|conflicted/i,
      "an unreadable audit row is not an audit row",
    );
    await assert.rejects(
      write("rider_page", "{oops", "{}"),
      /CK_SubscriberPreferenceChanges_BeforeJson|conflicted/i,
    );

    const rows = await pool.request().input("s", sql.UniqueIdentifier, id).query<{ source: string }>(
      "SELECT source FROM dbo.SubscriberPreferenceChanges WHERE subscriber_id=@s ORDER BY changed_at DESC",
    );
    assert.equal(rows.recordset.length, 3);
  } finally {
    await pool.close();
  }
});
