import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import { makeManageKey } from "./manageKey";
import {
  resolveManageKey,
  writePreferences,
  unsubscribeAll,
  readOptions,
  stateOf,
} from "./subscriberPreferences";

// Preference reads and writes against a real SQL Server (the CI contract job's
// container). Masking and validation are unit-tested; what needs a database is:
//
//   Resolution through merged_into. A link mailed before a merge is in
//   somebody's inbox, and answering "no such key" to a rider holding an
//   unsubscribe link we sent them is a failure with a compliance cost.
//
//   That a PUT assigns rather than unions. unionAudience is next door in
//   subscriberConfirmation and is the wrong function here; the difference is
//   only visible against stored rows.
//
//   That unsubscribing rotates the key, which is the one thing standing
//   between a long-lived credential and someone being re-enrolled from an old
//   email.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

const MIGRATIONS = [
  "migration-117-subscriber-channel-state.sql",
  "migration-118-subscriber-merge.sql",
  "migration-119-subscriber-manage-key.sql",
];

const BEFORE = `
IF OBJECT_ID('dbo.SubscriberPreferenceChanges','U') IS NOT NULL DROP TABLE dbo.SubscriberPreferenceChanges;
IF OBJECT_ID('dbo.SubscriberConfirmations','U') IS NOT NULL DROP TABLE dbo.SubscriberConfirmations;
IF OBJECT_ID('dbo.Subscribers','U') IS NOT NULL DROP TABLE dbo.Subscribers;
IF OBJECT_ID('dbo.OnDemandOperationalZones','U') IS NOT NULL DROP TABLE dbo.OnDemandOperationalZones;
IF OBJECT_ID('dbo.OnDemandOperationalZoneVersions','U') IS NOT NULL DROP TABLE dbo.OnDemandOperationalZoneVersions;
IF OBJECT_ID('dbo.GtfsRoutes','U') IS NOT NULL DROP TABLE dbo.GtfsRoutes;
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
CREATE TABLE dbo.GtfsRoutes (
  route_id NVARCHAR(50) NOT NULL PRIMARY KEY,
  route_short_name NVARCHAR(50) NULL, route_long_name NVARCHAR(200) NULL,
  route_sort_order INT NULL
);
CREATE TABLE dbo.OnDemandOperationalZoneVersions (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  feed_version NVARCHAR(200) NOT NULL, source_sha256 CHAR(64) NOT NULL,
  is_active BIT NOT NULL DEFAULT 0, imported_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.OnDemandOperationalZones (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  zone_version_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.OnDemandOperationalZoneVersions(id),
  external_location_id NVARCHAR(100) NOT NULL, name NVARCHAR(200) NOT NULL,
  geometry_json NVARCHAR(MAX) NOT NULL
);
INSERT dbo.GtfsRoutes (route_id, route_short_name, route_long_name, route_sort_order) VALUES
  ('470','470','Burnsville - Minneapolis',1), ('472','472','Savage - Minneapolis',2);
`;

async function reset(pool: sql.ConnectionPool) {
  await pool.request().batch(BEFORE);
  for (const file of MIGRATIONS) {
    const text = readFileSync(join(process.cwd(), "sql", file), "utf8");
    for (const batch of text.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) {
      await pool.request().batch(batch);
    }
  }
}

// This file creates SubscriberPreferenceChanges (via migration 119) and the
// zone tables. Every contract file shares one database and rebuilds its tables
// by dropping them, so a table left behind with a foreign key to one of those
// makes the NEXT file fail with a message naming the wrong cause.
after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try {
    await pool.request().batch(`
      IF OBJECT_ID('dbo.SubscriberPreferenceChanges','U') IS NOT NULL DROP TABLE dbo.SubscriberPreferenceChanges;
      IF OBJECT_ID('dbo.OnDemandOperationalZones','U') IS NOT NULL DROP TABLE dbo.OnDemandOperationalZones;
      IF OBJECT_ID('dbo.OnDemandOperationalZoneVersions','U') IS NOT NULL DROP TABLE dbo.OnDemandOperationalZoneVersions;
      IF OBJECT_ID('dbo.GtfsRoutes','U') IS NOT NULL DROP TABLE dbo.GtfsRoutes;`);
  } finally {
    await pool.close();
  }
});

interface Seed {
  phone?: string | null;
  email?: string | null;
  status?: string;
  smsStatus?: string | null;
  emailStatus?: string | null;
  categories?: string[];
  routes?: string;
  key?: string;
}

async function seed(pool: sql.ConnectionPool, s: Seed = {}): Promise<{ id: string; key: string }> {
  const key = s.key ?? makeManageKey();
  const id = (
    await pool
      .request()
      .input("phone", sql.NVarChar(20), s.phone ?? null)
      .input("email", sql.NVarChar(320), s.email ?? null)
      .input("status", sql.NVarChar(30), s.status ?? "confirmed")
      .input("sms", sql.NVarChar(30), s.smsStatus === undefined ? (s.phone ? "confirmed" : null) : s.smsStatus)
      .input("em", sql.NVarChar(30), s.emailStatus === undefined ? (s.email ? "confirmed" : null) : s.emailStatus)
      .input("cats", sql.NVarChar(sql.MAX), JSON.stringify(s.categories ?? ["delay", "detour"]))
      .input("routes", sql.NVarChar(sql.MAX), s.routes ?? "ALL")
      .input("key", sql.NVarChar(64), key)
      .query<{ subscriber_id: string }>(
        `INSERT dbo.Subscribers (phone_number, email, categories, routes, zones, status, sms_status, email_status, consent_source, manage_key, manage_key_issued_at)
         OUTPUT INSERTED.subscriber_id
         VALUES (@phone, @email, @cats, @routes, 'ALL', @status, @sms, @em, 'web_form', @key, SYSUTCDATETIME())`,
      )
  ).recordset[0].subscriber_id;
  return { id, key };
}

async function read(pool: sql.ConnectionPool, id: string) {
  return (
    await pool.request().input("id", sql.UniqueIdentifier, id).query<{
      categories: string; routes: string | null; status: string;
      sms_status: string | null; email_status: string | null;
      opted_out_reason: string | null; manage_key: string;
    }>("SELECT categories, routes, status, sms_status, email_status, opted_out_reason, manage_key FROM dbo.Subscribers WHERE subscriber_id=@id")
  ).recordset[0];
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

test("a key mailed before a merge still reaches the rider's subscription", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const survivor = await seed(pool, { phone: "+16125550123" });
    const folded = await seed(pool, { phone: "+16125550123" });
    await pool.request()
      .input("loser", sql.UniqueIdentifier, folded.id)
      .input("winner", sql.UniqueIdentifier, survivor.id)
      .query("UPDATE dbo.Subscribers SET merged_into=@winner, merged_at=SYSUTCDATETIME(), status='merged' WHERE subscriber_id=@loser");

    const resolved = await inTx(pool, (tx) => resolveManageKey(tx, folded.key));
    assert.equal(resolved?.subscriber_id, survivor.id, "the old link resolves to the record that survived");
    assert.equal(resolved?.merged_into, null, "and what comes back is a live record, not a merged one");

    // A chain, not just one hop: merges can happen more than once.
    const newest = await seed(pool, { phone: "+16125550123" });
    await pool.request()
      .input("loser", sql.UniqueIdentifier, survivor.id)
      .input("winner", sql.UniqueIdentifier, newest.id)
      .query("UPDATE dbo.Subscribers SET merged_into=@winner, merged_at=SYSUTCDATETIME(), status='merged' WHERE subscriber_id=@loser");
    assert.equal(
      (await inTx(pool, (tx) => resolveManageKey(tx, folded.key)))?.subscriber_id,
      newest.id,
      "two hops, from a link older than both merges",
    );
  } finally {
    await pool.close();
  }
});

test("a key that names nothing resolves to nothing, in every way it can", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    await seed(pool, { phone: "+16125550123" });
    for (const key of [makeManageKey(), "", "not-a-key", "A".repeat(64)]) {
      assert.equal(await inTx(pool, (tx) => resolveManageKey(tx, key)), null, `key ${JSON.stringify(key.slice(0, 12))}`);
    }
  } finally {
    await pool.close();
  }
});

test("a PUT assigns, so a rider can narrow what they receive", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const { id, key } = await seed(pool, {
      phone: "+16125550123",
      categories: ["delay", "detour", "closure"],
      routes: "ALL",
    });

    await inTx(pool, async (tx) => {
      const record = (await resolveManageKey(tx, key))!;
      return writePreferences(tx, record, {
        categories: ["delay"],
        routes: ["470"],
        zones: "ALL",
        channels: ["sms"],
      });
    });

    const row = await read(pool, id);
    // The whole point. unionAudience would have left all three categories and
    // "ALL" routes, and the rider would have changed nothing.
    assert.deepEqual(JSON.parse(row.categories), ["delay"], "categories are replaced, not merged");
    assert.equal(row.routes, '["470"]', "a rider narrowing from ALL to one route gets one route");
    assert.equal(row.status, "confirmed");

    // And the audit row says what it was before, which is the only answer to
    // "I never asked for that".
    const audit = (
      await pool.request().input("id", sql.UniqueIdentifier, id).query<{ before_state: string; after_state: string; source: string }>(
        "SELECT TOP 1 before_state, after_state, source FROM dbo.SubscriberPreferenceChanges WHERE subscriber_id=@id ORDER BY changed_at DESC",
      )
    ).recordset[0];
    assert.equal(audit.source, "rider_page");
    assert.deepEqual(JSON.parse(audit.before_state).categories, ["delay", "detour", "closure"]);
    assert.deepEqual(JSON.parse(audit.after_state).routes, ["470"]);
  } finally {
    await pool.close();
  }
});

test("stopping one channel leaves the other, and stopping both opts the record out", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const { id, key } = await seed(pool, { phone: "+16125550123", email: "a@example.com" });

    const put = (channels: ("sms" | "email")[]) =>
      inTx(pool, async (tx) => {
        const record = (await resolveManageKey(tx, key))!;
        return writePreferences(tx, record, { categories: ["delay"], routes: "ALL", zones: "ALL", channels });
      });

    await put(["email"]);
    let row = await read(pool, id);
    assert.equal(row.sms_status, "unsubscribed");
    assert.equal(row.email_status, "confirmed", "a channel they kept is untouched");
    assert.equal(row.status, "confirmed", "a subscriber with a live channel is still a subscriber");

    // Turning a stopped channel back on is refused, not quietly put back to
    // "waiting for confirmation" with nothing sent to confirm it. Resuming is
    // a new consent, which is the opt-in form's job.
    const revived = await put(["sms", "email"]);
    assert.equal(revived, "channel_stopped");
    row = await read(pool, id);
    assert.equal(row.sms_status, "unsubscribed", "nothing was written");
    assert.equal(row.email_status, "confirmed");

    await put([]);
    row = await read(pool, id);
    assert.equal(row.status, "opted_out", "nothing left to send on is not a subscriber");
    assert.equal(row.opted_out_reason, "email_link");
  } finally {
    await pool.close();
  }
});

test("an opted-out record is refused, not quietly revived", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const { id, key } = await seed(pool, {
      phone: "+16125550123", status: "opted_out", smsStatus: "unsubscribed", categories: ["delay"],
    });
    const outcome = await inTx(pool, async (tx) => {
      const record = (await resolveManageKey(tx, key))!;
      return writePreferences(tx, record, { categories: ["delay", "detour"], routes: "ALL", zones: "ALL", channels: ["sms"] });
    });
    // Coming back is a new consent, and the date someone agreed is what a TCPA
    // complaint turns on. A click on an old link is not that.
    assert.equal(outcome, "opted_out");
    const row = await read(pool, id);
    assert.deepEqual(JSON.parse(row.categories), ["delay"], "nothing was written");
    assert.equal(row.sms_status, "unsubscribed");
  } finally {
    await pool.close();
  }
});

test("unsubscribing rotates the key, so the link in the inbox stops working", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const { id, key } = await seed(pool, { phone: "+16125550123", email: "a@example.com" });
    await pool.request().input("id", sql.UniqueIdentifier, id).query(
      "INSERT dbo.SubscriberConfirmations (subscriber_id, channel, token, expires_at) VALUES (@id,'email','live-token',DATEADD(hour,24,SYSUTCDATETIME()))",
    );

    await inTx(pool, async (tx) => unsubscribeAll(tx, (await resolveManageKey(tx, key))!));

    const row = await read(pool, id);
    assert.equal(row.status, "opted_out");
    assert.equal(row.sms_status, "unsubscribed");
    assert.equal(row.email_status, "unsubscribed");
    assert.notEqual(row.manage_key, key, "the key is rotated");
    // This is what rotation buys: someone who has left cannot be re-enrolled
    // from the link still sitting in their inbox.
    assert.equal(await inTx(pool, (tx) => resolveManageKey(tx, key)), null);

    // And an outstanding confirmation is void, so they cannot confirm a channel
    // they just stopped.
    const live = await pool.request().input("id", sql.UniqueIdentifier, id).query<{ n: number }>(
      "SELECT COUNT(*) n FROM dbo.SubscriberConfirmations WHERE subscriber_id=@id AND confirmed_at IS NULL AND superseded_at IS NULL",
    );
    assert.equal(live.recordset[0].n, 0);
  } finally {
    await pool.close();
  }
});

test("the options offered are the live routes and only an active version's zones", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);

    // No zone version is active on dev today, and a page that offered zones
    // nobody can match would be worse than one that offers none.
    let options = await inTx(pool, (tx) => readOptions(tx));
    assert.deepEqual(options.routes.map((r) => r.id), ["470", "472"]);
    assert.deepEqual(options.routes.map((r) => r.label), ["470 - Burnsville - Minneapolis", "472 - Savage - Minneapolis"]);
    assert.deepEqual(options.zones, [], "no active version means nothing to choose");

    await pool.request().batch(`
      DECLARE @inactive UNIQUEIDENTIFIER = NEWID(), @active UNIQUEIDENTIFIER = NEWID();
      INSERT dbo.OnDemandOperationalZoneVersions (id, feed_version, source_sha256, is_active) VALUES
        (@inactive, 'v1', REPLICATE('a',64), 0), (@active, 'v2', REPLICATE('b',64), 1);
      INSERT dbo.OnDemandOperationalZones (zone_version_id, external_location_id, name, geometry_json) VALUES
        (@inactive, 'zone-old', 'Retired area', '{}'), (@active, 'zone-b', 'Burnsville', '{}'), (@active, 'zone-a', 'Apple Valley', '{}');`);

    options = await inTx(pool, (tx) => readOptions(tx));
    assert.deepEqual(
      options.zones.map((z) => z.id),
      ["zone-a", "zone-b"],
      "only the active version's zones, and in a rider-readable order",
    );
  } finally {
    await pool.close();
  }
});

test("what the page reads back is what was stored", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await reset(pool);
    const { key } = await seed(pool, { phone: "+16125550123", categories: ["delay"], routes: '["470"]' });
    const state = await inTx(pool, async (tx) => stateOf((await resolveManageKey(tx, key))!));
    assert.deepEqual(state.categories, ["delay"]);
    assert.deepEqual(state.routes, ["470"]);
    assert.equal(state.zones, "ALL");
    assert.equal(state.sms_status, "confirmed");
    assert.equal(state.email_status, null, "a channel they never gave has no state");
  } finally {
    await pool.close();
  }
});
