import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "./db";
import { restatementLedgerReady, upsertOtpMonthlyReport, type MappedOtpMonthlyReport } from "./otpMonthlyFeed";

// Recording an Avail restatement, against a real SQL Server.
//
// Nothing below can be proved without a database. The statement is composable
// DML - a MERGE whose OUTPUT is the source an INSERT selects from - which
// either parses and behaves or does not; and the behaviour that matters is the
// difference between "the poller ran" and "the number moved", which only shows
// up across two runs over real rows.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_otp_restatement_contract";
const MIGRATIONS = ["014-otp-monthly", "016-route-classification", "141-otp-monthly-restatements"];

function batches(text: string): string[] {
  return text.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(Boolean);
}

async function ownDatabase(cs: string): Promise<sql.ConnectionPool> {
  const admin = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try {
    await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END; CREATE DATABASE [${DATABASE}];`);
  } finally { await admin.close(); }
  return new sql.ConnectionPool({ ...parseConnectionString(cs), database: DATABASE }).connect();
}

async function dropDatabase(cs: string) {
  const admin = await new sql.ConnectionPool(parseConnectionString(cs)).connect();
  try { await admin.request().batch(`IF DB_ID('${DATABASE}') IS NOT NULL BEGIN ALTER DATABASE [${DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DATABASE}]; END;`); }
  finally { await admin.close(); }
}

const row = (over: Partial<MappedOtpMonthlyReport> = {}): MappedOtpMonthlyReport => ({
  service_month: "202608", route_id: 460, stop_id: 100, day_of_week: "Mon",
  stop_name: "Apple Valley", route_label: "460",
  pct_early: 0.1, pct_ontime: 0.8, pct_late: 0.1, pct_not_ontime: 0.2, pct_missed: 0,
  early: 10, ontime: 80, late: 10, missed: 0, actual_departures: 100, total: 100, ...over,
});

// September is "now" throughout: 202608 is a closed month, 202609 is the one
// still filling.
const NOW = { ledgerReady: true, currentServiceMonth: "202609" };

test("recording an Avail restatement against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async t => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const m of MIGRATIONS) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", `migration-${m}.sql`), "utf8"))) await pool.request().batch(b);
    }

    const ledger = async () => (await pool.request().query<{ n: number }>("SELECT COUNT(*) n FROM OtpMonthlyRestatements")).recordset[0].n;
    const stamps = async () => (await pool.request().query<{ first_seen_at: Date; updated_at: Date }>(
      "SELECT first_seen_at, updated_at FROM OtpMonthlyRouteStopDay WHERE service_month='202608' AND route_id=460 AND stop_id=100",
    )).recordset[0];

    await t.test("the ledger is found once the migration has run", async () => {
      assert.equal(await restatementLedgerReady(pool), true);
    });

    await t.test("a first ingestion is not a restatement - there was nothing to restate", async () => {
      await upsertOtpMonthlyReport(pool, row(), NOW);
      assert.equal(Number(await ledger()), 0);
    });

    await t.test("re-polling identical data leaves updated_at alone", async () => {
      const before = await stamps();
      await new Promise((resolve) => setTimeout(resolve, 15));
      await upsertOtpMonthlyReport(pool, row(), NOW);

      const after = await stamps();
      // The whole of F1: an unchanged row must not look like it was touched,
      // or a restatement is indistinguishable from the poller running.
      assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
      assert.equal(Number(await ledger()), 0);
    });

    await t.test("a closed month whose counts move is recorded, with what it used to say", async () => {
      const before = await stamps();
      await new Promise((resolve) => setTimeout(resolve, 15));
      await upsertOtpMonthlyReport(pool, row({ ontime: 70, total: 98 }), NOW);

      const after = await stamps();
      assert.ok(after.updated_at.getTime() > before.updated_at.getTime(), "a real change moves updated_at");
      // first_seen_at is untouched: the row is the same row.
      assert.equal(after.first_seen_at.getTime(), before.first_seen_at.getTime());

      const entries = (await pool.request().query<{
        service_month: string; previous_total: number; previous_ontime: number; new_total: number; new_ontime: number;
      }>("SELECT service_month, previous_total, previous_ontime, new_total, new_ontime FROM OtpMonthlyRestatements")).recordset;
      assert.equal(entries.length, 1);
      assert.deepEqual(
        [entries[0].service_month, entries[0].previous_total, entries[0].previous_ontime, entries[0].new_total, entries[0].new_ontime],
        ["202608", 100, 80, 98, 70],
      );
    });

    await t.test("the view publishes the delta and how long after the month it happened", async () => {
      const view = (await pool.request().query<{
        TotalDepartureDelta: number; OnTimeDepartureDelta: number; DaysAfterMonthEnd: number; RouteLabel: string | null;
      }>("SELECT TotalDepartureDelta, OnTimeDepartureDelta, DaysAfterMonthEnd, RouteLabel FROM vw_OtpRestatement")).recordset[0];
      // Avail took two departures away and moved ten out of on-time.
      assert.equal(Number(view.TotalDepartureDelta), -2);
      assert.equal(Number(view.OnTimeDepartureDelta), -10);
      assert.equal(view.RouteLabel, "460");
      // Detected today, against an August month end.
      assert.ok(Number(view.DaysAfterMonthEnd) > 0);
    });

    await t.test("a label or percentage moving updates the row but is not a restatement", async () => {
      const before = Number(await ledger());
      await upsertOtpMonthlyReport(pool, row({ ontime: 70, total: 98, stop_name: "Apple Valley Transit Station", pct_ontime: 0.714 }), NOW);

      // The row is written - updated_at is about the row, not only the counts.
      const name = (await pool.request().query<{ stop_name: string }>(
        "SELECT stop_name FROM OtpMonthlyRouteStopDay WHERE service_month='202608'")).recordset[0].stop_name;
      assert.equal(name, "Apple Valley Transit Station");
      // But the contractor is not assessed on a stop's name.
      assert.equal(Number(await ledger()), before);
    });

    await t.test("a month still filling is not restating - it is arriving", async () => {
      await upsertOtpMonthlyReport(pool, row({ service_month: "202609", total: 50, ontime: 40 }), NOW);
      const before = Number(await ledger());
      // Same row, more departures: exactly what every poll does all month.
      await upsertOtpMonthlyReport(pool, row({ service_month: "202609", total: 90, ontime: 72 }), NOW);
      assert.equal(Number(await ledger()), before);
    });

    await t.test("a NULL becoming a number counts, which <> would have missed", async () => {
      await upsertOtpMonthlyReport(pool, row({ stop_id: 101, total: null, ontime: null }), NOW);
      const before = Number(await ledger());
      await upsertOtpMonthlyReport(pool, row({ stop_id: 101, total: 40, ontime: 30 }), NOW);
      assert.equal(Number(await ledger()), before + 1);

      const entry = (await pool.request().query<{ previous_total: number | null; new_total: number }>(
        "SELECT TOP 1 previous_total, new_total FROM OtpMonthlyRestatements WHERE stop_id=101 ORDER BY detected_at DESC")).recordset[0];
      assert.equal(entry.previous_total, null);
      assert.equal(Number(entry.new_total), 40);
    });

    await t.test("without the ledger the upsert still runs, and still tells the truth about updated_at", async () => {
      await pool.request().batch("DROP VIEW dbo.vw_OtpRestatement; DROP TABLE dbo.OtpMonthlyRestatements;");
      assert.equal(await restatementLedgerReady(pool), false);

      const before = await stamps();
      await new Promise((resolve) => setTimeout(resolve, 15));
      await upsertOtpMonthlyReport(pool, row({ ontime: 70, total: 98, stop_name: "Apple Valley Transit Station", pct_ontime: 0.714 }), { ledgerReady: false });
      assert.equal((await stamps()).updated_at.getTime(), before.updated_at.getTime());
    });
  } finally {
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
