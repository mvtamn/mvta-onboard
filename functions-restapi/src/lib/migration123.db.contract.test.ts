import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionString, sql } from "./db";
import { upsertOtpDailyReport, type MappedOtpDaily } from "./otpDailyFeed";

// Migration 123 and the OTP Daily upsert against a real SQL Server (the CI
// contract job's container).
//
// What only a database can show: that migration 020's key really does refuse
// the second direction of a route/stop/hour (the defect), that 123 lets both
// directions stand, that the MERGE updates rather than duplicates on a re-read
// of the same day, and that a row with no direction is matched NULL to NULL
// instead of being inserted again on every run.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const skip = { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" };

async function apply(pool: sql.ConnectionPool, file: string) {
  const text = readFileSync(join(process.cwd(), "sql", file), "utf8");
  for (const batch of text.split(/^\s*GO\s*$/gim).map((p) => p.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
}

const RESET = `
IF OBJECT_ID('dbo.vw_OtpDailyRouteStopHour','V') IS NOT NULL DROP VIEW dbo.vw_OtpDailyRouteStopHour;
IF OBJECT_ID('dbo.OtpDailyRouteStopHour','U') IS NOT NULL DROP TABLE dbo.OtpDailyRouteStopHour;
`;

after(async () => {
  if (!connectionString) return;
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString)).connect();
  try {
    await pool.request().batch(RESET);
  } finally {
    await pool.close();
  }
});

// Route 446 at one stop at 06:00 on 2026-09-15, once per direction - the shape
// of the collision seen in the live response.
function row(direction: string | null, total: number): MappedOtpDaily {
  return {
    calendar_date: "20260915", hour_of_day: 6, route_id: 446, stop_id: 30535,
    stop_name: "Example stop", route_label: "446",
    pct_early: 0, pct_ontime: 1, pct_late: 0, pct_not_ontime: 0, pct_missed: 0,
    early: 0, ontime: total, late: 0, missed: 0, actual_departures: total, total,
    latitude: 44.98, longitude: -93.27, direction,
  };
}

async function rows(pool: sql.ConnectionPool) {
  return (await pool.request().query<{ direction: string | null; total: number }>(
    "SELECT direction, total FROM dbo.OtpDailyRouteStopHour ORDER BY direction",
  )).recordset;
}

test("migration 123 lets each direction of a route/stop/hour keep its own row", skip, async () => {
  const pool = await new sql.ConnectionPool(parseConnectionString(connectionString!)).connect();
  try {
    await pool.request().batch(RESET);
    await apply(pool, "migration-020-otp-daily.sql");

    // Before 123: the second direction cannot be stored. (Under the old MERGE,
    // which matched without direction, it overwrote the first instead.)
    await upsertOtpDailyReport(pool, row("N", 1));
    await assert.rejects(upsertOtpDailyReport(pool, row("S", 1)), /UX_OtpDailyRouteStopHour_Key|UNIQUE KEY/);

    await apply(pool, "migration-123-otp-daily-direction-key.sql");
    await apply(pool, "migration-123-otp-daily-direction-key.sql"); // re-runnable

    await upsertOtpDailyReport(pool, row("S", 1));
    assert.deepEqual(await rows(pool), [{ direction: "N", total: 1 }, { direction: "S", total: 1 }]);

    // The poll re-reads each day three times: a re-read updates in place.
    await upsertOtpDailyReport(pool, row("N", 2));
    await upsertOtpDailyReport(pool, row("S", 3));
    assert.deepEqual(await rows(pool), [{ direction: "N", total: 2 }, { direction: "S", total: 3 }]);

    // No direction: matched NULL to NULL, so a re-read does not add a row.
    await upsertOtpDailyReport(pool, row(null, 4));
    await upsertOtpDailyReport(pool, row(null, 5));
    assert.deepEqual(await rows(pool), [
      { direction: null, total: 5 },
      { direction: "N", total: 2 },
      { direction: "S", total: 3 },
    ]);
  } finally {
    await pool.close();
  }
});
