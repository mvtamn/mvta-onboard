import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "./db";

// Runs migration 101 against a real SQL Server (the CI contract job's
// container) on a Messages table seeded with every shape the column has
// held: JSON arrays, comma-separated strings with and without padding, a
// value that needs JSON escaping, blanks and NULLs. Skipped when no
// connection string is provided, like the Decision Matrix contract test.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;

async function runMigration(pool: sql.ConnectionPool, file: string): Promise<void> {
  const script = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of script.split(/^\s*GO\s*$/m)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

test("migration 101 converts legacy comma-separated Messages lists to JSON arrays and is re-runnable", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  const pool = new sql.ConnectionPool(parseConnectionString(connectionString));
  await pool.connect();
  try {
    await pool.request().batch(`
      IF OBJECT_ID('dbo.Messages', 'U') IS NOT NULL DROP TABLE dbo.Messages;
      CREATE TABLE dbo.Messages (
        message_id      INT IDENTITY(1,1) PRIMARY KEY,
        label           NVARCHAR(40)  NOT NULL,
        routes_affected NVARCHAR(MAX) NULL,
        stops_affected  NVARCHAR(MAX) NULL,
        zones_affected  NVARCHAR(MAX) NULL,
        tags            NVARCHAR(MAX) NULL,
        channels        NVARCHAR(MAX) NULL
      );
      INSERT INTO dbo.Messages (label, routes_affected, stops_affected, zones_affected, tags, channels) VALUES
        ('legacy',   '442,477',        NULL,          NULL,  'construction', 'web,sms'),
        ('padded',   ' 442 , 477 , ',  NULL,          NULL,  NULL,           ' web , sms '),
        ('json',     '["442","477"]',  '["12345"]',   '[]',  '["x"]',        '["web","sms","email"]'),
        ('blank',    '',               '   ',         NULL,  '',             ''),
        ('escaped',  NULL,             NULL,          NULL,  'a"b,c\\d',     'web'),
        ('nulls',    NULL,             NULL,          NULL,  NULL,           NULL);
    `);

    await runMigration(pool, "migration-101-messages-list-columns-json.sql");

    const rows = (await pool.request().query<{ label: string; routes_affected: string | null; stops_affected: string | null; zones_affected: string | null; tags: string | null; channels: string | null }>(
      "SELECT label, routes_affected, stops_affected, zones_affected, tags, channels FROM dbo.Messages ORDER BY message_id",
    )).recordset;
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));

    assert.deepEqual(byLabel.legacy, { label: "legacy", routes_affected: '["442","477"]', stops_affected: null, zones_affected: null, tags: '["construction"]', channels: '["web","sms"]' });
    assert.deepEqual(byLabel.padded, { label: "padded", routes_affected: '["442","477"]', stops_affected: null, zones_affected: null, tags: null, channels: '["web","sms"]' });
    assert.deepEqual(byLabel.json, { label: "json", routes_affected: '["442","477"]', stops_affected: '["12345"]', zones_affected: "[]", tags: '["x"]', channels: '["web","sms","email"]' });
    assert.deepEqual(byLabel.blank, { label: "blank", routes_affected: null, stops_affected: null, zones_affected: null, tags: null, channels: null });
    assert.deepEqual(byLabel.escaped, { label: "escaped", routes_affected: null, stops_affected: null, zones_affected: null, tags: '["a\\"b","c\\\\d"]', channels: '["web"]' });
    assert.deepEqual(byLabel.nulls, { label: "nulls", routes_affected: null, stops_affected: null, zones_affected: null, tags: null, channels: null });

    // Every non-null value is now valid JSON that SQL Server itself accepts.
    const invalid = (await pool.request().query<{ n: number }>(`
      SELECT COUNT(*) AS n FROM dbo.Messages
      WHERE (routes_affected IS NOT NULL AND ISJSON(routes_affected) = 0)
         OR (stops_affected  IS NOT NULL AND ISJSON(stops_affected)  = 0)
         OR (zones_affected  IS NOT NULL AND ISJSON(zones_affected)  = 0)
         OR (tags            IS NOT NULL AND ISJSON(tags)            = 0)
         OR (channels        IS NOT NULL AND ISJSON(channels)        = 0)
    `)).recordset[0].n;
    assert.equal(invalid, 0);

    // Re-running changes nothing.
    await runMigration(pool, "migration-101-messages-list-columns-json.sql");
    const again = (await pool.request().query<{ label: string; tags: string | null; channels: string | null }>("SELECT label, tags, channels FROM dbo.Messages ORDER BY message_id")).recordset;
    assert.deepEqual(again.map((r) => [r.label, r.tags, r.channels]), rows.map((r) => [r.label, r.tags, r.channels]));
  } finally {
    await pool.request().batch("IF OBJECT_ID('dbo.Messages', 'U') IS NOT NULL DROP TABLE dbo.Messages;").catch(() => undefined);
    await pool.close();
  }
});
