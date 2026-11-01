import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "./db";

// Migration 153 (ridership counting, ADR 0043) against a real SQL Server, in a
// database of its own (see access.db.contract.test.ts).
//
// What only the database can show: that a second run is a no-op, that the
// scheduled end is backfilled only where the import still has the trip, and
// that the CHECKs hold the rule the spec rests on - a trip nobody counted is a
// gap, never a zero, and only a counted trip carries a number.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_migration153_contract";

async function ownDatabase(cs: string): Promise<sql.ConnectionPool> {
  const admin = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try {
    await admin.request().batch(
      `IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END; CREATE DATABASE [${DATABASE}];`,
    );
  } finally {
    await admin.close();
  }
  return new sql.ConnectionPool({ ...parseConnectionString(cs), database: DATABASE }).connect();
}

async function apply(pool: sql.ConnectionPool) {
  const text = readFileSync(join(process.cwd(), "sql", "migration-153-ridership-counting.sql"), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

// Just the columns 153 reads; the real tables come from migrations 027/125 and 094.
const PREREQUISITES = `
CREATE TABLE dbo.GtfsScheduledTrips (trip_id NVARCHAR(100) PRIMARY KEY, last_arrival_seconds INT NULL);
CREATE TABLE dbo.TripStartLog (service_date CHAR(8) NOT NULL, trip_id NVARCHAR(100) NOT NULL, PRIMARY KEY (service_date, trip_id));
INSERT dbo.GtfsScheduledTrips VALUES ('t-in-import', 23100);
INSERT dbo.TripStartLog VALUES ('20261028', 't-in-import'), ('20261028', 't-gone');
`;

test("migration 153 against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async (t) => {
  const pool = await ownDatabase(connectionString!);
  const run = (q: string) => pool.request().batch(q);
  try {
    await run(PREREQUISITES);
    await apply(pool);
    await apply(pool); // re-runnable

    await t.test("backfills the scheduled end only for trips the import still has", async () => {
      const rows = (await pool.request().query<{ trip_id: string; scheduled_end_seconds: number | null }>(
        "SELECT trip_id, scheduled_end_seconds FROM dbo.TripStartLog ORDER BY trip_id",
      )).recordset;
      assert.deepEqual(rows, [
        { trip_id: "t-gone", scheduled_end_seconds: null },
        { trip_id: "t-in-import", scheduled_end_seconds: 23100 },
      ]);
    });

    await run(`INSERT dbo.RidershipSheets (service_date, block, created_by) VALUES ('20261028', '024', 'contract test');`);
    const count = (status: string, boardings: string, trip = "t-1", block = "024") =>
      run(`INSERT dbo.RidershipCounts (service_date, trip_id, block, count_status, boardings, created_by)
           VALUES ('20261028', '${trip}', '${block}', '${status}', ${boardings}, 'contract test');`);

    await t.test("a counted trip needs a number, and zero is a number", async () => {
      await assert.rejects(count("counted", "NULL"), /CK_RidershipCounts_Boardings/);
      await count("counted", "0", "t-zero");
      await assert.rejects(count("counted", "-1", "t-neg"), /CK_RidershipCounts_Boardings/);
    });

    await t.test("not counted and did not operate never carry a number", async () => {
      await assert.rejects(count("not_counted", "0"), /CK_RidershipCounts_Boardings/);
      await assert.rejects(count("did_not_operate", "3"), /CK_RidershipCounts_Boardings/);
      await count("not_counted", "NULL", "t-gap");
      await count("did_not_operate", "NULL", "t-dno");
      await assert.rejects(count("zero", "NULL", "t-bad"), /CK_RidershipCounts_Status/);
    });

    await t.test("a count belongs to a sheet, and a block is three digits", async () => {
      await assert.rejects(count("counted", "5", "t-orphan", "105"), /FK_RidershipCounts_Sheet/);
      await assert.rejects(
        run(`INSERT dbo.RidershipSheets (service_date, block, created_by) VALUES ('20261028', '24', 'contract test');`),
        /CK_RidershipSheets_Block/,
      );
    });

    await t.test("an added trip is counted or not counted, never did-not-operate", async () => {
      await assert.rejects(
        run(`INSERT dbo.RidershipAddedTrips (service_date, block, route_short_name, direction_label, scheduled_start_seconds, reason, count_status, boardings, created_by)
             VALUES ('20261028', '024', '460', 'N', 27000, 'tripper', 'did_not_operate', NULL, 'contract test');`),
        /CK_RidershipAddedTrips_Status/,
      );
      await run(`INSERT dbo.RidershipAddedTrips (service_date, block, route_short_name, direction_label, scheduled_start_seconds, reason, count_status, boardings, created_by)
                 VALUES ('20261028', '024', '460', 'N', 27000, 'tripper', 'counted', 23, 'contract test');`);
    });
  } finally {
    await pool.close();
  }
});
