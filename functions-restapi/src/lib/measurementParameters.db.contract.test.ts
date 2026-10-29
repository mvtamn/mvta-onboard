import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "./db";
import {
  declareParameters,
  parameterSegments,
  readDeclarationHistory,
  readParametersInForce,
  type OtpMeasurementParameterSet,
} from "./otpMeasurementParameters";

// The measurement parameter register against a real SQL Server (ADR 0042).
//
// Three things cannot be proved without a database, and each of them is a way
// the provenance could silently lie.
//
// The persisted computed column builds the segment string in SQL while
// `parameterSegments` builds it in TypeScript, and that string is both the URL
// Avail is sent and the stamp stored beside every figure. If the two ever
// disagree about the ORDER of the seven numbers, OnBoard polls one standard and
// records another, and nothing else would notice.
//
// "In force" is a query, not a comparison: the newest declaration whose
// effective_from has arrived. A future-dated declaration taking effect early
// would restate figures nobody had agreed to restate yet.
//
// And the register's CHECK constraint is the last line against a set that
// measures nothing - it has to refuse what `validateParameterSet` refuses, or
// the API is the only thing standing between a typo and the contract figure.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_otp_measurement_parameters_contract";
const MIGRATIONS = ["014-otp-monthly", "020-otp-daily", "151-otp-measurement-parameters"];

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

const set = (over: Partial<OtpMeasurementParameterSet> = {}): OtpMeasurementParameterSet => ({
  early_threshold_minutes: 2,
  late_threshold_minutes: 5,
  early_outlier_minutes: 10,
  late_outlier_minutes: 60,
  show_missed_stops: 0,
  include_outliers: 1,
  show_detours: 1,
  ...over,
});

test("the OTP measurement parameter register against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async t => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const m of MIGRATIONS) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", `migration-${m}.sql`), "utf8"))) await pool.request().batch(b);
    }

    await t.test("the migration seeds both sets this feed has been polled under", async () => {
      const history = await readDeclarationHistory(pool);
      assert.deepEqual(history.map((row) => [row.effective_from, row.segments]), [
        ["2026-10-27", "2/5/10/60/0/1/1"],
        ["2026-01-01", "1/5/15/30/0/1/1"],
      ]);
      // The spec-example set is recorded as what it was, not as a standard.
      assert.match(history[1]!.source, /not MVTA's standard/);
    });

    await t.test("the set in force is MVTA's confirmed standard, with its provenance", async () => {
      const inForce = await readParametersInForce(pool);
      assert.equal(inForce.segments, "2/5/10/60/0/1/1");
      assert.equal(inForce.origin, "register");
      assert.equal(inForce.declaration?.effective_from, "2026-10-27");
      assert.match(inForce.declaration!.source, /Avail confirmation/);
    });

    await t.test("SQL and TypeScript agree about the order of the seven numbers", async () => {
      // The one that matters most: this string is the URL AND the stamp.
      const declaration = await declareParameters(
        pool,
        { ...set({ early_threshold_minutes: 3, late_threshold_minutes: 7, early_outlier_minutes: 11, late_outlier_minutes: 44, show_missed_stops: 1, include_outliers: 0, show_detours: 0 }), effective_from: "2026-10-28", source: "contract test" },
        "tester",
      );
      const persisted = (await pool.request().query<{ segments: string }>(
        `SELECT segments FROM OtpMeasurementParameters WHERE id = '${declaration.id}'`)).recordset[0]!.segments;
      assert.equal(persisted, "3/7/11/44/1/0/0");
      assert.equal(persisted, parameterSegments(declaration));
      assert.equal(declaration.segments, persisted);
    });

    await t.test("a future-dated declaration does not take effect early", async () => {
      await declareParameters(
        pool,
        { ...set({ early_threshold_minutes: 4 }), effective_from: "2099-01-01", source: "a standard Avail announced ahead of time" },
        "tester",
      );
      const inForce = await readParametersInForce(pool);
      // 2026-10-28's declaration is the newest that has arrived.
      assert.equal(inForce.segments, "3/7/11/44/1/0/0");
      // But it is on the record, so nobody declares it twice.
      assert.ok((await readDeclarationHistory(pool)).some((row) => row.effective_from === "2099-01-01"));
    });

    await t.test("the register refuses a set that would measure nothing", async () => {
      // An outlier bound at its own threshold leaves the band it bounds empty.
      await assert.rejects(
        declareParameters(pool, { ...set({ early_outlier_minutes: 2 }), effective_from: "2026-11-01", source: "typo" }, "tester"),
        /CK_OtpMeasurementParameters_Thresholds/,
      );
      await assert.rejects(
        declareParameters(pool, { ...set({ late_threshold_minutes: 0 }), effective_from: "2026-11-01", source: "typo" }, "tester"),
        /CK_OtpMeasurementParameters_Thresholds/,
      );
    });

    await t.test("a declaration is appended, never an edit of the one before it", async () => {
      const before = await readDeclarationHistory(pool);
      await declareParameters(
        pool,
        { ...set(), effective_from: "2026-10-27", source: "Avail confirmation 2026-10-27", notes: "re-declared with a corrected source" },
        "tester",
      );
      const after = await readDeclarationHistory(pool);
      assert.equal(after.length, before.length + 1);
      // Same effective date, two rows: the later declaration wins, and the
      // earlier one stays as what figures were polled under.
      assert.equal(after.filter((row) => row.effective_from === "2026-10-27").length, 2);
    });

    await t.test("both OTP tables can be stamped, and start out unrecorded", async () => {
      for (const table of ["OtpMonthlyRouteStopDay", "OtpDailyRouteStopHour"]) {
        const column = (await pool.request().query<{ nullable: boolean; max_length: number }>(
          `SELECT is_nullable nullable, max_length FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.${table}') AND name = 'measurement_parameters'`)).recordset[0];
        assert.ok(column, `${table} should carry the stamp`);
        // Nullable on purpose: NULL means "not recorded", and every row stored
        // before this migration is one. (The driver gives sys.columns.is_nullable
        // as a boolean, not as the BIT's 1.)
        assert.equal(column!.nullable, true);
      }
    });

    await t.test("without the register the pollers still get a standard to poll with", async () => {
      await pool.request().batch("DROP VIEW dbo.vw_OtpMeasurementParameters; DROP TABLE dbo.OtpMeasurementParameters;");
      const inForce = await readParametersInForce(pool);
      assert.equal(inForce.segments, "2/5/10/60/0/1/1");
      assert.equal(inForce.origin, "code");
      assert.equal(inForce.declaration, null);
      assert.deepEqual(await readDeclarationHistory(pool), []);
    });
  } finally {
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
