import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "./db";
import { upsertOtpMonthlyReport, type MappedOtpMonthlyReport } from "./otpMonthlyFeed";
import { retireVanishedMonthlyKeys, retirementArchiveReady } from "./otpMonthlyRetirement";

// Retiring vanished keys against a real SQL Server (ADR 0043).
//
// This is the first code that DELETES a contractual OTP figure, so the parts
// that cannot be proved without a database are the parts that matter most:
// that nothing is removed without being archived first, that the coverage gate
// refuses a short payload against real rows rather than against a mock, and
// that the composable DELETE ... OUTPUT INTO ... INSERT is legal SQL at all -
// the restatement contract test earned that caution by catching an illegal
// second WHEN MATCHED clause in CI.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_otp_retirement_contract";
// 021 is not optional scenery: migration 014 declares day_of_week NVARCHAR(3),
// and Avail really sends "Thur" - which is why 021 widened it to 20. Without it
// the stranded-row fixture dies on "String or binary data would be truncated",
// and the schema under test is not the one in production.
const MIGRATIONS = [
  "014-otp-monthly",
  "020-otp-daily",
  "021-otp-monthly-day-of-week-width",
  "151-otp-measurement-parameters",
  "152-retire-vanished-otp-monthly-keys",
];
const DECLARED = "2/5/10/60/0/1/1";

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

function row(over: Partial<MappedOtpMonthlyReport> = {}): MappedOtpMonthlyReport {
  return {
    service_month: "202605",
    route_id: 420,
    stop_id: 30131,
    day_of_week: "Mon",
    stop_name: "157th Street Station",
    route_label: "420",
    pct_early: 0,
    pct_ontime: 65.6,
    pct_late: 34.4,
    pct_not_ontime: 34.4,
    pct_missed: 0,
    early: 0,
    ontime: 21,
    late: 11,
    missed: 0,
    actual_departures: 32,
    total: 32,
    ...over,
  };
}

/** Stores `count` keys for a month, stamped with the declared standard. */
async function storeMonth(pool: sql.ConnectionPool, serviceMonth: string, count: number): Promise<MappedOtpMonthlyReport[]> {
  const stored: MappedOtpMonthlyReport[] = [];
  for (let i = 0; i < count; i++) {
    const mapped = row({ service_month: serviceMonth, stop_id: 30000 + i, total: 10 + i, ontime: 9 + i });
    await upsertOtpMonthlyReport(pool, mapped, {
      ledgerReady: false,
      currentServiceMonth: "202610",
      measurementParameters: DECLARED,
      stampReady: true,
    });
    stored.push(mapped);
  }
  return stored;
}

async function liveKeys(pool: sql.ConnectionPool, serviceMonth: string): Promise<number> {
  const result = await pool.request().query<{ n: number }>(
    `SELECT COUNT(*) n FROM dbo.OtpMonthlyRouteStopDay WHERE service_month = '${serviceMonth}'`);
  return result.recordset[0]!.n;
}

test("retiring vanished OTP monthly keys against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async t => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const m of MIGRATIONS) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", `migration-${m}.sql`), "utf8"))) await pool.request().batch(b);
    }

    await t.test("migration 152 creates the archive the feed probes for", async () => {
      assert.equal(await retirementArchiveReady(pool), true);
    });

    await t.test("a key absent from an otherwise whole month is archived, then removed", async () => {
      const stored = await storeMonth(pool, "202601", 20);
      const [vanished, ...returned] = stored;

      const result = await retireVanishedMonthlyKeys(pool, {
        serviceMonth: "202601",
        returned,
        retiredBy: "contract test",
        archiveReady: true,
      });

      assert.equal(result.retire, true);
      assert.equal(result.stored, 20);
      assert.equal(result.absent, 1);
      assert.equal(result.retired.length, 1);
      assert.equal(result.retired[0]!.stop_id, vanished!.stop_id);
      // The figure left with it.
      assert.equal(result.retired[0]!.total, vanished!.total);
      assert.equal(await liveKeys(pool, "202601"), 19);

      // Archived whole: the stamp, the figures and the row's own history.
      const archived = (await pool.request().query<{
        total: number; ontime: number; measurement_parameters: string | null;
        first_seen_at: Date; updated_at: Date; retired_reason: string; retired_by: string;
      }>(`SELECT total, ontime, measurement_parameters, first_seen_at, updated_at, retired_reason, retired_by
          FROM dbo.OtpMonthlyRetiredKeys
          WHERE service_month = '202601' AND stop_id = ${vanished!.stop_id}`)).recordset;
      assert.equal(archived.length, 1);
      assert.equal(archived[0]!.total, vanished!.total);
      assert.equal(archived[0]!.measurement_parameters, DECLARED);
      assert.ok(archived[0]!.first_seen_at instanceof Date);
      assert.equal(archived[0]!.retired_by, "contract test");
      // Why, in words - a count explains nothing a year later.
      assert.match(archived[0]!.retired_reason, /did not return this route\/stop\/day of week/);
      assert.match(archived[0]!.retired_reason, /95\.0% of the month/);
    });

    await t.test("a short payload deletes nothing at all", async () => {
      await storeMonth(pool, "202602", 20);
      const result = await retireVanishedMonthlyKeys(pool, {
        serviceMonth: "202602",
        // Two keys out of twenty: a truncated response, not a cleared month.
        returned: [row({ service_month: "202602", stop_id: 30000 }), row({ service_month: "202602", stop_id: 30001 })],
        retiredBy: "contract test",
        archiveReady: true,
      });
      assert.equal(result.retire, false);
      assert.equal(result.absent, 18);
      assert.equal(result.retired.length, 0);
      assert.equal(await liveKeys(pool, "202602"), 20);
      assert.equal(
        (await pool.request().query<{ n: number }>(
          "SELECT COUNT(*) n FROM dbo.OtpMonthlyRetiredKeys WHERE service_month = '202602'")).recordset[0]!.n,
        0,
      );
    });

    await t.test("a payload that brought everything back touches nothing", async () => {
      const stored = await storeMonth(pool, "202603", 12);
      const result = await retireVanishedMonthlyKeys(pool, {
        serviceMonth: "202603",
        returned: stored,
        retiredBy: "contract test",
        archiveReady: true,
      });
      assert.equal(result.retire, false);
      assert.equal(result.absent, 0);
      assert.equal(await liveKeys(pool, "202603"), 12);
    });

    await t.test("only the named month is at risk", async () => {
      await storeMonth(pool, "202604", 10);
      await storeMonth(pool, "202607", 10);
      // Nothing returned for 202604 would retire all ten - except the gate
      // refuses it. So return nine of ten, and prove 202607 is untouched.
      const stored = (await pool.request().query<{ stop_id: number }>(
        "SELECT stop_id FROM dbo.OtpMonthlyRouteStopDay WHERE service_month = '202604' ORDER BY stop_id")).recordset;
      const result = await retireVanishedMonthlyKeys(pool, {
        serviceMonth: "202604",
        returned: stored.slice(1).map((r) => row({ service_month: "202604", stop_id: r.stop_id })),
        retiredBy: "contract test",
        archiveReady: true,
      });
      assert.equal(result.retired.length, 1);
      assert.equal(await liveKeys(pool, "202604"), 9);
      assert.equal(await liveKeys(pool, "202607"), 10);
    });

    await t.test("a key that comes back is stored again, and keeps both lives", async () => {
      const stored = await storeMonth(pool, "202606", 20);
      const [vanished, ...returned] = stored;
      await retireVanishedMonthlyKeys(pool, {
        serviceMonth: "202606", returned, retiredBy: "contract test", archiveReady: true,
      });
      assert.equal(await liveKeys(pool, "202606"), 19);

      // Avail sends it again. The upsert inserts it, since nothing matches.
      await upsertOtpMonthlyReport(pool, { ...vanished!, total: 99, ontime: 90 }, {
        ledgerReady: false, currentServiceMonth: "202610", measurementParameters: DECLARED, stampReady: true,
      });
      assert.equal(await liveKeys(pool, "202606"), 20);
      const back = (await pool.request().query<{ total: number; measurement_parameters: string | null }>(
        `SELECT total, measurement_parameters FROM dbo.OtpMonthlyRouteStopDay
         WHERE service_month = '202606' AND stop_id = ${vanished!.stop_id}`)).recordset[0]!;
      assert.equal(back.total, 99);
      assert.equal(back.measurement_parameters, DECLARED);

      // And the retirement is still on the record: a key that comes and goes
      // leaves a history rather than a row that quietly changed meaning.
      assert.equal(
        (await pool.request().query<{ n: number }>(
          `SELECT COUNT(*) n FROM dbo.OtpMonthlyRetiredKeys
           WHERE service_month = '202606' AND stop_id = ${vanished!.stop_id}`)).recordset[0]!.n,
        1,
      );
    });

    await t.test("without the archive nothing is deleted", async () => {
      const stored = await storeMonth(pool, "202608", 20);
      const result = await retireVanishedMonthlyKeys(pool, {
        serviceMonth: "202608",
        returned: stored.slice(1),
        retiredBy: "contract test",
        // What a poll sees when 152 has not been applied yet.
        archiveReady: false,
      });
      assert.equal(result.retire, false);
      assert.match(result.reason, /archive is not applied/);
      assert.equal(await liveKeys(pool, "202608"), 20);
    });

    await t.test("the migration's one-off repair retires a stranded row and spares an unpolled month", async () => {
      // A month re-polled since migration 151: stamped rows, plus one row the
      // re-pull did not return.
      await storeMonth(pool, "202609", 5);
      await pool.request().batch(`
        INSERT INTO dbo.OtpMonthlyRouteStopDay (service_month, route_id, stop_id, day_of_week, stop_name, total, ontime)
        VALUES ('202609', 499, 31967, 'Thur', 'Shakopee Walmart', 17, 17);
        -- A month never re-polled since 151: every row unstamped. Left alone.
        INSERT INTO dbo.OtpMonthlyRouteStopDay (service_month, route_id, stop_id, day_of_week, stop_name, total, ontime)
        VALUES ('202512', 420, 30131, 'Mon', '157th Street Station', 30, 25);
      `);

      for (const b of batches(readFileSync(join(process.cwd(), "sql", "migration-152-retire-vanished-otp-monthly-keys.sql"), "utf8"))) {
        await pool.request().batch(b);
      }

      assert.equal(await liveKeys(pool, "202609"), 5);
      // Not a candidate: the month has no stamped row, so it has not been
      // re-polled, so nothing has been shown to be absent.
      assert.equal(await liveKeys(pool, "202512"), 1);
      const archived = (await pool.request().query<{ stop_id: number; retired_by: string; retired_reason: string }>(
        "SELECT stop_id, retired_by, retired_reason FROM dbo.OtpMonthlyRetiredKeys WHERE service_month = '202609'")).recordset;
      assert.equal(archived.length, 1);
      assert.equal(archived[0]!.stop_id, 31967);
      assert.equal(archived[0]!.retired_by, "migration-152");
      assert.match(archived[0]!.retired_reason, /nothing can ever stamp it/);
    });

    await t.test("the reporting view publishes what left and why", async () => {
      const published = (await pool.request().query<{
        ServiceMonth: string; ServiceMonthStart: Date; StopName: string | null; TotalDepartures: number | null;
        MeasuredUnder: string | null; RetiredBy: string;
      }>("SELECT ServiceMonth, ServiceMonthStart, StopName, TotalDepartures, MeasuredUnder, RetiredBy FROM dbo.vw_OtpMonthlyRetiredKeys WHERE ServiceMonth = '202609'")).recordset;
      assert.equal(published.length, 1);
      assert.equal(published[0]!.StopName, "Shakopee Walmart");
      assert.equal(published[0]!.TotalDepartures, 17);
      // Unstamped, which is the finding rather than a gap.
      assert.equal(published[0]!.MeasuredUnder, null);
      assert.equal(new Date(published[0]!.ServiceMonthStart).toISOString().slice(0, 10), "2026-09-01");
    });
  } finally {
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
