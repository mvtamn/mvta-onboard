import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseConnectionString, sql } from "../db";
import { reviewSchedule } from "./index";
import { feed } from "./fixture.test-support";
import { compareReviews, latestReview, latestSegments, routeDetail, saveReview } from "./store";

// The stored schedule review against a real SQL Server. review.test.ts covers
// the review itself, which is pure; this file covers what only the database
// can show:
//
//   saving on change - stored, unchanged (confirmed), evidence refreshed in place;
//   a stored result for a check that no longer exists dropped from every read,
//   with the route's counts recounted without it;
//   the history pairing - newest against the one before, time order whichever
//   way round, the same review twice, a review that is not kept;
//   migration 146 folding a run of identical daily rows into one.
//
// Tables come from the real migrations, in a database of its own.
const connectionString = process.env.DECISION_MATRIX_TEST_SQL_CONNECTION_STRING;
const DATABASE = "mvta_schedule_review_contract";
const MIGRATIONS = ["010-gtfs-routes", "143-gtfs-prediction-risk-reviews", "145-schedule-review-route-detail"];
const DEDUPE = "146-schedule-review-one-row-per-change";

function batches(name: string): string[] {
  const text = readFileSync(join(process.cwd(), "sql", `migration-${name}.sql`), "utf8");
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

function feedInfo(version: string): string {
  return `feed_publisher_name,feed_publisher_url,feed_lang,feed_version\nMVTA,https://example.test,en,${version}\n`;
}

test("stored schedule review against real SQL", { skip: !connectionString && "DECISION_MATRIX_TEST_SQL_CONNECTION_STRING not set" }, async (t) => {
  const pool = await ownDatabase(connectionString!);
  try {
    for (const m of MIGRATIONS) for (const b of batches(m)) await pool.request().batch(b);
    await pool.request().query(
      "INSERT INTO GtfsRoutes (route_id, route_short_name, route_long_name, route_type) VALUES ('R1', '401', 'Test Route One', 3)",
    );

    const first = reviewSchedule(feed({ feedInfoCsv: feedInfo("V1") }));
    const second = reviewSchedule(feed({ feedInfoCsv: feedInfo("V2") }));
    let firstId = 0;
    let secondId = 0;

    await t.test("before any sync there is no review and nothing to compare", async () => {
      assert.equal(await latestReview(pool), null);
      assert.deepEqual(await routeDetail(pool, "R1"), { state: "none" });
      assert.equal((await latestSegments(pool)).size, 0);
      assert.deepEqual(await compareReviews(pool), { state: "ready", history: [], diff: null });
    });

    await t.test("a first review is stored with its detail and read back with long names and counts", async () => {
      assert.equal(await saveReview(pool, first), "stored");
      const latest = await latestReview(pool);
      assert.ok(latest);
      assert.equal(latest.feed.version, "V1");
      assert.equal(latest.confirmed_at, null);
      const r1 = latest.routes.find((r) => r.route_id === "R1");
      assert.equal(r1?.route_long_name, "Test Route One");
      assert.equal(typeof r1?.fixable_flag_count, "number");
      const detail = await routeDetail(pool, "R1");
      assert.equal(detail.state, "ready");
      assert.deepEqual(await routeDetail(pool, "NOPE"), { state: "route_missing" });
      assert.deepEqual([...(await latestSegments(pool)).keys()].sort(), first.details.map((d) => d.route_id).sort());
      const comparison = await compareReviews(pool);
      assert.equal(comparison.state, "ready");
      if (comparison.state === "ready") firstId = comparison.history[0].review_id;
    });

    await t.test("the same review again is confirmed, not stored again", async () => {
      assert.equal(await saveReview(pool, first), "unchanged");
      const latest = await latestReview(pool);
      assert.ok(latest?.confirmed_at);
      const comparison = await compareReviews(pool);
      assert.equal(comparison.state, "ready");
      if (comparison.state === "ready") assert.equal(comparison.history.length, 1);
    });

    await t.test("the same verdict with different evidence refreshes the detail in place", async () => {
      const richer = { ...first, details: first.details.map((d) => ({ ...d, segments: [] })) };
      assert.equal(await saveReview(pool, richer), "detail_refreshed");
      const comparison = await compareReviews(pool);
      if (comparison.state === "ready") assert.equal(comparison.history.length, 1);
      const detail = await routeDetail(pool, "R1");
      assert.equal(detail.state === "ready" && detail.route.segments.length, 0);
    });

    await t.test("a new feed is a new review, and the default comparison is it against the one before", async () => {
      assert.equal(await saveReview(pool, second), "stored");
      const comparison = await compareReviews(pool);
      assert.equal(comparison.state, "ready");
      if (comparison.state !== "ready") return;
      assert.equal(comparison.history.length, 2);
      secondId = comparison.history[0].review_id;
      assert.notEqual(secondId, firstId);
      assert.equal(comparison.diff?.from.review_id, firstId);
      assert.equal(comparison.diff?.to.review_id, secondId);
      assert.equal(comparison.diff?.cause, "feed");
    });

    await t.test("asked the wrong way round, the reviews are compared in time order", async () => {
      const comparison = await compareReviews(pool, { from: secondId, to: firstId });
      assert.equal(comparison.state === "ready" && comparison.diff?.from.review_id, firstId);
    });

    await t.test("the same review twice, or one that is not kept, is said so", async () => {
      assert.deepEqual(await compareReviews(pool, { from: firstId, to: firstId }), { state: "same_review" });
      assert.deepEqual(await compareReviews(pool, { from: firstId, to: 999_999 }), { state: "not_kept" });
    });

    await t.test("a stored result for a retired check is dropped from every read and the counts recounted", async () => {
      const retired = { id: "retired_check", value: 1, flagged: true };
      const routes = second.summary.routes.map((r) => ({ ...r, checks: [...r.checks, retired], flag_count: r.flag_count + 1 }));
      const inserted = await pool.request()
        .input("review_json", sql.NVarChar(sql.MAX), JSON.stringify({ feed: second.summary.feed, routes, distance: second.distance }))
        .query<{ review_id: number }>(`
          INSERT INTO GtfsPredictionRiskReviews (feed_version, route_count, flagged_route_count, review_json)
          OUTPUT INSERTED.review_id VALUES ('V2', ${routes.length}, ${routes.length}, @review_json)
        `);
      const retiredId = inserted.recordset[0].review_id;
      for (const d of second.details) {
        await pool.request()
          .input("review_id", sql.Int, retiredId).input("route_id", sql.NVarChar(50), d.route_id)
          .input("detail_json", sql.NVarChar(sql.MAX), JSON.stringify({ ...d, checks: [...d.checks, { ...retired, evidence: [] }], flag_count: d.flag_count + 1 }))
          .query("INSERT INTO GtfsScheduleReviewRoutes (review_id, route_id, detail_json) VALUES (@review_id, @route_id, @detail_json)");
      }

      const expected = second.summary.routes.find((r) => r.route_id === "R1")!;
      const latest = await latestReview(pool);
      const r1 = latest?.routes.find((r) => r.route_id === "R1");
      assert.ok(r1 && !r1.checks.some((c) => (c.id as string) === "retired_check"));
      assert.equal(r1?.flag_count, expected.flag_count);

      const detail = await routeDetail(pool, "R1");
      assert.equal(detail.state, "ready");
      if (detail.state !== "ready") return;
      assert.ok(!detail.route.checks.some((c) => (c.id as string) === "retired_check"));
      assert.equal(detail.route.flag_count, expected.flag_count);
      assert.equal(detail.route.fixable_flag_count + detail.route.structural_flag_count, expected.flag_count);

      const comparison = await compareReviews(pool, { from: secondId, to: retiredId });
      assert.equal(comparison.state === "ready" && comparison.diff?.gained.length, 0);
      assert.deepEqual(comparison.state === "ready" && comparison.diff?.checks_added, []);
    });

    await t.test("migration 146 folds each run of identical daily rows into its newest row", async () => {
      await pool.request().batch("DELETE FROM GtfsScheduleReviewRoutes; DELETE FROM GtfsPredictionRiskReviews;");
      const insert = async (json: string, at: string) => (await pool.request()
        .input("review_json", sql.NVarChar(sql.MAX), json).input("at", sql.DateTime2, new Date(at))
        .query<{ review_id: number }>(`
          INSERT INTO GtfsPredictionRiskReviews (reviewed_at, feed_version, route_count, flagged_route_count, review_json)
          OUTPUT INSERTED.review_id VALUES (@at, NULL, 1, 0, @review_json)
        `)).recordset[0].review_id;
      // A, A, A, then B, B (the second B with its 145-era detail and confirmation), then A again.
      await insert("A", "2026-10-01T09:00:00Z");
      await insert("A", "2026-10-02T09:00:00Z");
      const keepA = await insert("A", "2026-10-03T09:00:00Z");
      await insert("B", "2026-10-04T09:00:00Z");
      const keepB = await insert("B", "2026-10-05T09:00:00Z");
      await pool.request().input("id", sql.Int, keepB).query(`
        UPDATE GtfsPredictionRiskReviews SET confirmed_at = '2026-10-07T09:00:00' WHERE review_id = @id;
        INSERT INTO GtfsScheduleReviewRoutes (review_id, route_id, detail_json) VALUES (@id, 'R1', '{}');
      `);
      const laterA = await insert("A", "2026-10-08T09:00:00Z");

      for (const run of [1, 2]) {
        for (const b of batches(DEDUPE)) await pool.request().batch(b);
        const rows = (await pool.request().query<{ review_id: number; reviewed_at: Date; confirmed_at: Date | null }>(
          "SELECT review_id, reviewed_at, confirmed_at FROM GtfsPredictionRiskReviews ORDER BY reviewed_at",
        )).recordset;
        assert.deepEqual(rows.map((r) => r.review_id), [keepA, keepB, laterA], `run ${run}`);
        assert.equal(rows[0].reviewed_at.toISOString(), "2026-10-01T09:00:00.000Z");
        assert.equal(rows[0].confirmed_at?.toISOString(), "2026-10-03T09:00:00.000Z");
        assert.equal(rows[1].reviewed_at.toISOString(), "2026-10-04T09:00:00.000Z");
        assert.equal(rows[1].confirmed_at?.toISOString(), "2026-10-07T09:00:00.000Z");
        assert.equal(rows[2].confirmed_at, null);
      }
      const detail = await pool.request().query<{ review_id: number }>("SELECT review_id FROM GtfsScheduleReviewRoutes");
      assert.deepEqual(detail.recordset.map((r) => r.review_id), [keepB]);
    });
  } finally {
    await pool.close();
    await dropDatabase(connectionString!);
  }
});
