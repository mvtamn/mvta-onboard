import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "../db";
import {
  recordStopExclusion,
  stopExclusionsForMonth,
  timeline,
} from "./index";

// The exclusion review module against a real SQL Server. exclusionReview.test.ts
// covers the merge and the shaping, which are pure; this file covers what only
// the database can show:
//
//   re-reviewing a stop upserting in place rather than adding a row;
//   a month reaching BOTH kinds of exclusion - the defect fixed in 1.5.291,
//   where ?month= filtered stop exclusions and never weather days;
//   a weather day scoped by the date it happened, not when it was logged;
//   the timeline bounded in SQL and ordered newest first across both tables.
//
// Tables come from the real migration, in a database of its own.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_otp_exclusion_review_contract";
const MIGRATIONS = ["018-otp-exclusions-and-settings", "022-otp-stop-exclusions-day-of-week-width"];
const ACTOR = "review-contract";

function batches(text: string): string[] {
  return text.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
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

test("exclusion review against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async (t) => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const m of MIGRATIONS) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", `migration-${m}.sql`), "utf8"))) {
        await pool.request().batch(b);
      }
    }

    await t.test("re-reviewing a stop upserts in place", async () => {
      const decision = {
        service_month: "202609", route_id: 490, stop_id: 13209,
        day_of_week: "Monday", status: "approved" as const, reason_code: "SCHED_RECOVERY",
      };
      const first = await recordStopExclusion(pool, decision, ACTOR);
      const second = await recordStopExclusion(pool, { ...decision, status: "rejected", reason_code: null }, ACTOR);

      assert.equal(first.id, second.id, "the same stop and day must not gain a second row");
      assert.equal(second.status, "rejected");
      assert.equal(second.reason_code, null);
      const rows = await stopExclusionsForMonth(pool, "202609");
      assert.equal(rows.length, 1);
      // Only the current state survives: this is the known limit of deriving
      // the timeline from the records rather than from a log.
      assert.equal(rows[0]?.status, "rejected");
    });

    await t.test("a month's decisions are its own", async () => {
      await recordStopExclusion(pool, {
        service_month: "202608", route_id: 446, stop_id: 30535,
        day_of_week: "Tuesday", status: "approved", reason_code: "LAYOVER",
      }, ACTOR);
      assert.deepEqual((await stopExclusionsForMonth(pool, "202609")).map((r) => r.route_id), [490]);
      assert.deepEqual((await stopExclusionsForMonth(pool, "202608")).map((r) => r.route_id), [446]);
      assert.deepEqual(await stopExclusionsForMonth(pool, "202512"), []);
    });

    await t.test("weather days seeded straight into the table are visible to the timeline", async () => {
      // Written with SQL rather than through this module: ADR 0038 gave weather
      // days an approval flow of their own, and this module only reads them.
      // created_at is today for both rows, so a timeline that scoped by it
      // instead of by service_date would put them in the wrong month.
      await pool.request().batch(`
        INSERT INTO OtpDateExclusions(scope,route_id,service_date,reason_code,created_by) VALUES
         ('Agency',NULL,'20260908','WEATHER_SNOW','${ACTOR}'),
         ('Route',446,'20260815','WEATHER_HEAT','${ACTOR}');
      `);
    });

    await t.test("scoping the timeline to a month reaches both kinds", async () => {
      // The defect fixed in 1.5.291: ?month= filtered stop exclusions and was
      // never applied to weather days, so a stream scoped to one month listed
      // every weather day ever recorded.
      const september = await timeline(pool, { month: "202609" });
      assert.deepEqual(september.map((e) => e.kind).sort(), ["stop_exclusion", "weather_day"]);
      assert.equal(september.length, 2);

      const august = await timeline(pool, { month: "202608" });
      assert.equal(august.length, 2);
      const augustWeather = august.find((e) => e.kind === "weather_day");
      assert.equal(augustWeather?.kind === "weather_day" ? augustWeather.service_date : null, "20260815");

      assert.deepEqual(await timeline(pool, { month: "202512" }), []);
    });

    await t.test("the whole timeline is every month, newest first and bounded", async () => {
      const all = await timeline(pool);
      assert.equal(all.length, 4);
      const times = all.map((e) => e.at);
      assert.deepEqual([...times].sort().reverse(), times, "entries must be newest first");

      assert.equal((await timeline(pool, { limit: 1 })).length, 1);
      assert.equal((await timeline(pool, { limit: 3 })).length, 3);
    });

    await t.test("a day-of-week value longer than three characters survives the round trip", async () => {
      // migration 022 widened the column because real Avail values overflowed
      // the original "Mon"/"Tue" size.
      const saved = await recordStopExclusion(pool, {
        service_month: "202609", route_id: 444, stop_id: 31928,
        day_of_week: "Weekday - Friday", status: "approved", reason_code: null,
      }, ACTOR);
      assert.equal(saved.day_of_week, "Weekday - Friday");
    });
  } finally {
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
