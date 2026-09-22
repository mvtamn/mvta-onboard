import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "../db";
import { isOtpRowAssessable, measureOtpMonth, measureOtpTrend, otpAssessableJoinsSql, otpAssessableSql } from "./index";
import { takeDateExclusionSnapshot } from "../otpDateExclusionSnapshot";

// The OTP month measurement module against a real SQL Server. rules.test.ts
// covers the rule itself and guards the reporting view's copy of it; this file
// covers what only the database can show:
//
//   raw, excluded and assessable over real rows, agency-wide and per route,
//   with special-event service and approved stop exclusions taken out;
//   the SQL test and its TypeScript twin agreeing row for row;
//   the target coming from the month's frozen rule set, and from the catalog
//   when the month has no period of its own;
//   weather days counted, and an approved one subtracting what it was
//     approved with (ADR 0038);
//   the trend reading the assessable figure, oldest first.
//
// Tables come from the real migrations, in a database of its own (see
// assessmentLifecycle.db.contract.test.ts).
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_otp_month_contract";
const MIGRATIONS = [
  "014-otp-monthly", "016-route-classification", "018-otp-exclusions-and-settings",
  "020-otp-daily", "030-contractor-performance-assessment", "032b-governed-performance-assessment",
  "102-agreement-scoped-standards", "107-penalty-scaling",
  "123-otp-daily-direction-key", "140-otp-date-exclusion-departures",
];

const CONTRACTOR = "c0000000-0000-4000-8000-000000000001";
const AGREEMENT = "a0000000-0000-4000-8000-000000000001";
const PERIOD = "b0000000-0000-4000-8000-000000000001";
const ACTOR = "otp-contract";
const SNOW_MONDAY = "d0000000-0000-4000-8000-000000000001";
const SNOW_WEDNESDAY = "d0000000-0000-4000-8000-000000000002";
const SNOW_JULY = "d0000000-0000-4000-8000-000000000003";

// 460 is fixed route; 1131 is a state-fair shuttle; 4444 is MVTA Connect.
// Each route has one stop on Mon and one on Tue, so an exclusion can take out
// exactly one day of one stop without touching the rest.
const FEED = `
INSERT OtpMonthlyRouteStopDay(service_month,route_id,stop_id,day_of_week,stop_name,route_label,total,ontime,pct_ontime) VALUES
 ('202608',460,100,'Mon','Apple Valley','460',100,80,0.80),
 ('202608',460,100,'Tue','Apple Valley','460',100,90,0.90),
 ('202608',460,101,'Mon','Burnsville TS','460',100,40,0.40),
 ('202608',1131,900,'Mon','Fair Gate','St Fair Shuttle',50,10,0.20),
 ('202608',4444,800,'Mon','Connect Zone','MVTA Connect',20,4,0.20),
 ('202607',460,100,'Mon','Apple Valley','460',200,180,0.90);
INSERT RouteClassification(route_id,route_category,route_label,updated_by) VALUES
 (1131,'SpecialEvent','St Fair Shuttle','${ACTOR}'),
 (4444,'OnDemand','MVTA Connect','${ACTOR}');
-- Approved: 460's worst stop on Monday. Rejected: the same stop on Tuesday,
-- which must stay in the figure.
INSERT OtpStopExclusions(service_month,route_id,stop_id,day_of_week,reason_code,status,reviewed_by) VALUES
 ('202608',460,101,'Mon','SCHED_RECOVERY','approved','${ACTOR}'),
 ('202608',460,100,'Tue','SCHED_RECOVERY','rejected','${ACTOR}');
-- 2026-08-10 is a Monday, so it can land on the Monday rows above; 2026-08-12
-- is a Wednesday, which the feed has no rows for at all. Both are recorded, so
-- the difference between "recorded" and "actually subtracting" is visible.
INSERT OtpDateExclusions(id,scope,service_date,reason_code,status,created_by) VALUES
 ('${SNOW_MONDAY}','Agency','20260810','WEATHER_SNOW','Proposed','${ACTOR}'),
 ('${SNOW_WEDNESDAY}','Agency','20260812','WEATHER_SNOW','Proposed','${ACTOR}'),
 ('${SNOW_JULY}','Agency','20260712','WEATHER_SNOW','Approved','${ACTOR}');
-- What the daily feed holds for the Monday: 30 of route 460 stop 100's 100
-- Monday departures, 12 of them on time. Route 1131 is a fair shuttle and
-- never reaches the figure; stop 900 is on no monthly row at all.
INSERT OtpDailyRouteStopHour(calendar_date,hour_of_day,route_id,stop_id,stop_name,route_label,total,ontime) VALUES
 ('20260810',7,460,100,'Apple Valley','460',20,8),
 ('20260810',8,460,100,'Apple Valley','460',10,4),
 ('20260810',7,1131,900,'Fair Gate','St Fair Shuttle',50,10);
`;

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

const pct = (figure: { pct: number | null }) => figure.pct === null ? null : Math.round(figure.pct * 10000) / 10000;

test("OTP month measurement against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async t => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const m of MIGRATIONS) {
      for (const b of batches(readFileSync(join(process.cwd(), "sql", `migration-${m}.sql`), "utf8"))) await pool.request().batch(b);
    }
    await pool.request().batch(FEED);

    await t.test("special-event and on-demand service and approved exclusions come out; the rest is the assessable figure", async () => {
      const measurement = await measureOtpMonth(pool, "202608");
      // Raw is every row: 100+100+100+50+20 departures.
      assert.deepEqual([measurement.raw.departures, measurement.raw.ontime], [370, 224]);
      // Assessable is route 460's Mon and Tue at stop 100 only: the fair
      // shuttle and MVTA Connect are not this standard's service, and stop 101
      // on Monday was approved for exclusion.
      assert.deepEqual([measurement.assessable.departures, measurement.assessable.ontime], [200, 170]);
      assert.deepEqual([measurement.excluded.departures, measurement.excluded.ontime], [170, 54]);
      assert.equal(pct(measurement.assessable), 0.85);
      assert.equal(pct(measurement.raw), 0.6054);
      assert.equal(measurement.feed_ready, true);

      const routes = Object.fromEntries(measurement.routes.map(route => [route.route_id, route]));
      assert.deepEqual(Object.keys(routes).sort(), ["1131", "4444", "460"]);
      assert.deepEqual([routes[460].raw.departures, routes[460].assessable.departures], [300, 200]);
      // A route whose service this standard does not cover has no assessable
      // departures, so it is neither below target nor above it.
      assert.deepEqual([routes[1131].assessable.departures, routes[1131].below_target], [0, null]);
      assert.equal(routes[1131].route_category, "SpecialEvent");
      assert.equal(routes[460].route_category, "FixedRoute");
      assert.equal(routes[460].route_label, "460");
    });

    await t.test("the SQL rule and its TypeScript twin agree on every row", async () => {
      const rows = (await pool.request().query<{ route_id: number; stop_id: number; day_of_week: string; route_category: string | null; stop_excluded: number; assessable: number }>(`
        SELECT otp.route_id, otp.stop_id, otp.day_of_week, classification.route_category,
          CASE WHEN exclusion.id IS NULL THEN 0 ELSE 1 END stop_excluded,
          ${otpAssessableSql()} assessable
        FROM dbo.OtpMonthlyRouteStopDay otp
        ${otpAssessableJoinsSql()}
      `)).recordset;
      assert.equal(rows.length, 6);
      for (const row of rows) {
        const twin = isOtpRowAssessable({ route_category: row.route_category, stop_excluded: row.stop_excluded === 1 });
        assert.equal(row.assessable === 1, twin, `${row.route_id}/${row.stop_id}/${row.day_of_week}`);
      }
    });

    await t.test("a recorded weather day changes nothing until it is approved", async () => {
      const august = await measureOtpMonth(pool, "202608");
      // Both August dates are recorded; neither is approved, so neither moves
      // the figure. A date exclusion is a request until somebody approves it.
      assert.equal(august.weather_days_recorded, 2);
      assert.equal(august.weather_days_applied, 0);
      assert.equal(august.assessable.departures, 200);
      assert.deepEqual([august.date_excluded.departures, august.date_excluded.ontime], [0, 0]);
      assert.equal((await measureOtpMonth(pool, "202607")).weather_days_recorded, 1);
    });

    await t.test("a date the feed cannot evidence is refused rather than approved into a no-op", async () => {
      // 2026-08-12 is a Wednesday and the month has no Wednesday rows.
      const wednesday = await takeDateExclusionSnapshot(pool, SNOW_WEDNESDAY, "20260812", null);
      assert.deepEqual(wednesday, { kind: "refused", reason: { kind: "day_of_week_absent", dayOfWeek: "Wed" } });
      // July's approved date has no daily rows at all - the feed keeps 90 days.
      const july = await takeDateExclusionSnapshot(pool, SNOW_JULY, "20260712", null);
      assert.equal(july.kind, "refused");
      assert.equal(july.kind === "refused" && july.reason.kind, "day_of_week_absent");
      // Nothing was written by either refusal.
      const written = (await pool.request().query<{ n: number }>("SELECT COUNT(*) n FROM OtpDateExclusionDepartures")).recordset[0].n;
      assert.equal(Number(written), 0);
    });

    await t.test("an approved weather day subtracts exactly what it was approved with", async () => {
      const snapshot = await takeDateExclusionSnapshot(pool, SNOW_MONDAY, "20260810", null);
      // Only route 460 stop 100 is frozen. The fair shuttle ran that Monday and
      // is in the monthly feed, but it is not this standard's service, so a
      // snapshot row for it could never subtract anything - and 30 is then
      // exactly what left the figure, which is what the receipt should say.
      assert.deepEqual(snapshot, { kind: "taken", serviceMonth: "202608", dayOfWeek: "Mon", rows: 1, departures: 30 });

      // Still Proposed, so still subtracting nothing.
      assert.equal((await measureOtpMonth(pool, "202608")).assessable.departures, 200);

      await pool.request().batch(`UPDATE OtpDateExclusions SET status='Approved' WHERE id='${SNOW_MONDAY}'`);
      const august = await measureOtpMonth(pool, "202608");
      assert.equal(august.weather_days_applied, 1);
      assert.deepEqual([august.date_excluded.departures, august.date_excluded.ontime], [30, 12]);
      // 200 - 30 assessable departures, 170 - 12 on time.
      assert.deepEqual([august.assessable.departures, august.assessable.ontime], [170, 158]);
      // Raw is untouched, and the two subtractions are told apart.
      assert.deepEqual([august.raw.departures, august.raw.ontime], [370, 224]);
      assert.deepEqual([august.stop_excluded.departures, august.stop_excluded.ontime], [170, 54]);
      assert.deepEqual([august.excluded.departures, august.excluded.ontime], [200, 66]);

      // The route carries the same subtraction.
      const route460 = august.routes.find((route) => route.route_id === 460)!;
      assert.deepEqual([route460.date_excluded.departures, route460.assessable.departures], [30, 170]);

      // The reporting view publishes the identical figure.
      const view = (await pool.request().query<{ total: number; ontime: number }>(`
        SELECT SUM(AssessableTotalDepartures) total, SUM(AssessableOnTimeDepartures) ontime
        FROM vw_OtpMonthlyRouteStop WHERE ServiceMonth = '202608'
      `)).recordset[0];
      assert.deepEqual([Number(view.total), Number(view.ontime)], [170, 158]);

      // Put August back, so the tests after this one see the month they expect.
      await pool.request().batch(`UPDATE OtpDateExclusions SET status='Proposed' WHERE id='${SNOW_MONDAY}'`);
    });

    await t.test("a month with no Assessment Period is judged by the catalog's current band", async () => {
      const measurement = await measureOtpMonth(pool, "202608");
      assert.deepEqual([measurement.target, measurement.target_source], [0.85, "catalog"]);
      // 0.85 exactly is not below 0.85; route 460's stop 101 carried the month.
      assert.equal(measurement.routes_below_target, 0);
    });

    await t.test("a month with an Assessment Period is judged by that period's frozen rules", async () => {
      await pool.request().batch(`
        INSERT Contractors(id,name,contract_start_date,contract_end_date,is_active,updated_by) VALUES('${CONTRACTOR}','Transit Operations','20260101','20261231',1,'${ACTOR}');
        INSERT PerformanceAgreements(id,contractor_id,starts_on,ends_on,is_active,created_by) VALUES('${AGREEMENT}','${CONTRACTOR}','2026-01-01','2026-12-31',1,'${ACTOR}');
        INSERT AssessmentPeriods(id,contractor_id,agreement_id,service_month,status) VALUES('${PERIOD}','${CONTRACTOR}','${AGREEMENT}','202608','in_review');
        INSERT AssessmentPeriodStandards(period_id,standard_id,code,name,standard_type,direction,is_safety_critical,measurement_source,sort_order,target_value)
          SELECT '${PERIOD}',id,code,name,standard_type,direction,is_safety_critical,measurement_source,sort_order,0.90 FROM ContractorPerformanceStandards WHERE code='OTP_FIXED_ROUTE';
        INSERT AssessmentPeriodTiers(period_id,standard_id,tier_order,tier_label,bound_low,bound_high,qualifier_code,penalty_basis,penalty_amount,triggers_cap)
          SELECT '${PERIOD}',standard_id,1,'meets',0.90,NULL,NULL,'none',0,0 FROM AssessmentPeriodStandards WHERE period_id='${PERIOD}';`);
      const measurement = await measureOtpMonth(pool, "202608");
      assert.deepEqual([measurement.target, measurement.target_source], [0.90, "period_rule_set"]);
      // The same figures, judged against the month's own target: 85% is below 90%.
      assert.equal(measurement.routes_below_target, 1);
      // A caller that knows the period says so and gets the same answer.
      assert.equal((await measureOtpMonth(pool, "202608", { periodId: PERIOD })).target, 0.90);
      // A month the period does not cover still reads the catalog.
      assert.deepEqual(await measureOtpMonth(pool, "202607").then(m => [m.target, m.target_source]), [0.85, "catalog"]);
    });

    await t.test("the trend reports the assessable figure per month, oldest first", async () => {
      const trend = await measureOtpTrend(pool, 6);
      assert.deepEqual(trend.map(month => month.service_month), ["202607", "202608"]);
      assert.deepEqual([trend[1].assessable.departures, trend[1].raw.departures], [200, 370]);
      assert.deepEqual([trend[0].assessable.departures, trend[0].raw.departures], [200, 200]);
      // The window is months, not rows.
      assert.deepEqual((await measureOtpTrend(pool, 1)).map(month => month.service_month), ["202608"]);
    });
  } finally {
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
