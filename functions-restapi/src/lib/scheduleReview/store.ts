// Where the static sync keeps each schedule review, and how the API reads it
// back: the summary row in GtfsPredictionRiskReviews (migration 143) and, once
// migration 145 is applied, one detail row per route in
// GtfsScheduleReviewRoutes.
//
// Written on change, not on every sync. The verdict (the summary) decides
// whether a new review row is written; the evidence behind an unchanged
// verdict is refreshed in place, so new code that records more about a
// segment reaches the detail without adding a row to the history.
//
// The feed changes a few times a year
// and the sync runs daily, so a row a day was the same review 150 times over
// and made feed-to-feed history unreadable. With 145 applied an identical
// review only stamps confirmed_at on the row it already has; a new one (a new
// feed, or new code) gets a new row with its detail. Without 145 the daily
// insert of v1.5.319 carries on unchanged.
import { sql } from "../db";
import type { PredictionRiskFeedInfo, PredictionRiskReview, RouteScheduleDetail, ScheduleReview } from "./types";
import { withFlagCounts, type RankedRoute } from "./ranking";

export interface ServedPredictionRiskRoute extends RankedRoute {
  /** From GtfsRoutes; null when the table has no row or no long name for it. */
  route_long_name: string | null;
}

export interface StoredPredictionRiskReview extends Omit<PredictionRiskReview, "routes"> {
  reviewed_at: string;
  /** Last sync that found the same review; null before migration 145. */
  confirmed_at: string | null;
  routes: ServedPredictionRiskRoute[];
}

/** route_id -> route_long_name from the static sync's GtfsRoutes table; empty if it is missing. */
export async function loadRouteLongNames(pool: sql.ConnectionPool): Promise<Map<string, string>> {
  if (!await tableReady(pool, "GtfsRoutes")) return new Map();
  const result = await pool.request().query<{ route_id: string; route_long_name: string | null }>(
    "SELECT route_id, route_long_name FROM GtfsRoutes",
  );
  return new Map(result.recordset.filter((r) => r.route_long_name).map((r) => [r.route_id, r.route_long_name as string]));
}

const REVIEWS_TABLE = "GtfsPredictionRiskReviews";
const DETAIL_TABLE = "GtfsScheduleReviewRoutes";

async function tableReady(pool: sql.ConnectionPool, table: string): Promise<boolean> {
  const result = await pool.request().query<{ ready: number }>(
    `SELECT CASE WHEN OBJECT_ID('dbo.${table}', 'U') IS NULL THEN 0 ELSE 1 END AS ready`,
  );
  return result.recordset[0]?.ready === 1;
}

function summaryJson(review: ScheduleReview): string {
  return JSON.stringify({ feed: review.summary.feed, routes: review.summary.routes, distance: review.distance });
}

export type SaveOutcome =
  /** A new review was stored with its per-route detail. */
  | "stored"
  /** The latest stored review is identical; its confirmed_at was stamped. */
  | "unchanged"
  /**
   * The verdict is identical but the evidence behind it is not (new code
   * records more about a segment): the latest review's detail rows were
   * replaced in place and confirmed_at stamped. No new review row, because
   * nothing a reader compares across reviews changed.
   */
  | "detail_refreshed"
  /** Migration 145 is not applied: the summary was stored as before, without detail. */
  | "detail_table_missing"
  /** Migration 143 is not applied: nothing was stored. */
  | "summary_table_missing";

/** Whether the stored per-route detail differs from the review's. Pure, for the save path and its test. */
export function detailChanged(stored: ReadonlyMap<string, string>, details: readonly RouteScheduleDetail[]): boolean {
  if (stored.size !== details.length) return true;
  return details.some((detail) => stored.get(detail.route_id) !== JSON.stringify(detail));
}

async function writeDetail(tx: sql.Transaction, reviewId: number, details: readonly RouteScheduleDetail[]): Promise<void> {
  for (const detail of details) {
    await new sql.Request(tx)
      .input("review_id", sql.Int, reviewId)
      .input("route_id", sql.NVarChar(50), detail.route_id)
      .input("detail_json", sql.NVarChar(sql.MAX), JSON.stringify(detail))
      .query(`INSERT INTO ${DETAIL_TABLE} (review_id, route_id, detail_json) VALUES (@review_id, @route_id, @detail_json)`);
  }
}

export async function savePredictionRiskReview(pool: sql.ConnectionPool, review: ScheduleReview): Promise<SaveOutcome> {
  if (!await tableReady(pool, REVIEWS_TABLE)) return "summary_table_missing";
  const json = summaryJson(review);
  const detailReady = await tableReady(pool, DETAIL_TABLE);

  if (detailReady) {
    const latest = await pool.request().query<{ review_id: number; review_json: string; detail_rows: number }>(`
      SELECT TOP 1 r.review_id, r.review_json,
             (SELECT COUNT(*) FROM ${DETAIL_TABLE} d WHERE d.review_id = r.review_id) AS detail_rows
      FROM ${REVIEWS_TABLE} r
      ORDER BY r.reviewed_at DESC, r.review_id DESC
    `);
    const row = latest.recordset[0];
    // A row from before 145 has no detail; it is replaced rather than confirmed.
    if (row && row.review_json === json && row.detail_rows > 0) {
      const storedDetail = await pool.request().input("review_id", sql.Int, row.review_id)
        .query<{ route_id: string; detail_json: string }>(`SELECT route_id, detail_json FROM ${DETAIL_TABLE} WHERE review_id = @review_id`);
      const stored = new Map(storedDetail.recordset.map((d) => [d.route_id, d.detail_json]));
      if (!detailChanged(stored, review.details)) {
        await pool.request().input("review_id", sql.Int, row.review_id)
          .query(`UPDATE ${REVIEWS_TABLE} SET confirmed_at = SYSUTCDATETIME() WHERE review_id = @review_id`);
        return "unchanged";
      }
      const refresh = new sql.Transaction(pool);
      await refresh.begin();
      try {
        await new sql.Request(refresh).input("review_id", sql.Int, row.review_id)
          .query(`DELETE FROM ${DETAIL_TABLE} WHERE review_id = @review_id`);
        await writeDetail(refresh, row.review_id, review.details);
        await new sql.Request(refresh).input("review_id", sql.Int, row.review_id)
          .query(`UPDATE ${REVIEWS_TABLE} SET confirmed_at = SYSUTCDATETIME() WHERE review_id = @review_id`);
        await refresh.commit();
      } catch (err) {
        await refresh.rollback();
        throw err;
      }
      return "detail_refreshed";
    }
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const inserted = await new sql.Request(tx)
      .input("feed_version", sql.NVarChar(100), review.summary.feed.version)
      .input("route_count", sql.Int, review.summary.routes.length)
      .input("flagged_route_count", sql.Int, review.summary.routes.filter((r) => r.flag_count > 0).length)
      .input("review_json", sql.NVarChar(sql.MAX), json)
      .query<{ review_id: number }>(`
        INSERT INTO ${REVIEWS_TABLE} (feed_version, route_count, flagged_route_count, review_json)
        OUTPUT INSERTED.review_id
        VALUES (@feed_version, @route_count, @flagged_route_count, @review_json)
      `);
    const reviewId = inserted.recordset[0].review_id;
    if (detailReady) await writeDetail(tx, reviewId, review.details);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  return detailReady ? "stored" : "detail_table_missing";
}

export type LatestPredictionRiskReview =
  | { state: "ready"; review: StoredPredictionRiskReview }
  | { state: "none" }
  | { state: "migration_missing" };

type StoredSummary = Pick<PredictionRiskReview, "feed" | "routes">;

// The check definitions are not stored with the row: they are read from the
// code, so a review always describes its checks in today's words. A stored
// result for a check that no longer exists is dropped rather than shown with
// no explanation.
export async function loadLatestPredictionRiskReview(
  pool: sql.ConnectionPool,
  checks: PredictionRiskReview["checks"],
): Promise<LatestPredictionRiskReview> {
  if (!await tableReady(pool, REVIEWS_TABLE)) return { state: "migration_missing" };
  const hasConfirmed = await tableReady(pool, DETAIL_TABLE);
  const result = await pool.request().query<{ reviewed_at: Date; confirmed_at: Date | null; review_json: string }>(`
    SELECT TOP 1 reviewed_at, ${hasConfirmed ? "confirmed_at" : "CAST(NULL AS DATETIME2) AS confirmed_at"}, review_json
    FROM ${REVIEWS_TABLE}
    ORDER BY reviewed_at DESC, review_id DESC
  `);
  const row = result.recordset[0];
  if (!row) return { state: "none" };
  const stored = JSON.parse(row.review_json) as StoredSummary;
  const known = new Set(checks.map((c) => c.id));
  const names = await loadRouteLongNames(pool);
  const routes = withFlagCounts(stored.routes.map((route) => ({ ...route, checks: route.checks.filter((c) => known.has(c.id)) })), checks);
  return {
    state: "ready",
    review: {
      reviewed_at: row.reviewed_at.toISOString(),
      confirmed_at: row.confirmed_at ? row.confirmed_at.toISOString() : null,
      feed: stored.feed,
      checks,
      routes: routes.map((route) => ({ ...route, route_long_name: names.get(route.route_id) ?? null })),
    },
  };
}

export type StoredRouteScheduleDetail =
  | {
      state: "ready";
      reviewed_at: string;
      confirmed_at: string | null;
      feed: PredictionRiskFeedInfo;
      route: RouteScheduleDetail;
      route_long_name: string | null;
    }
  /** The latest review has no detail for this route: not in the feed, or stored before migration 145. */
  | { state: "route_missing" }
  | { state: "none" }
  | { state: "migration_missing" };

export async function loadRouteScheduleDetail(
  pool: sql.ConnectionPool,
  routeId: string,
  checks: PredictionRiskReview["checks"],
): Promise<StoredRouteScheduleDetail> {
  if (!await tableReady(pool, REVIEWS_TABLE) || !await tableReady(pool, DETAIL_TABLE)) return { state: "migration_missing" };
  const result = await pool.request().input("route_id", sql.NVarChar(50), routeId)
    .query<{ reviewed_at: Date; confirmed_at: Date | null; review_json: string; detail_json: string | null }>(`
      SELECT TOP 1 r.reviewed_at, r.confirmed_at, r.review_json, d.detail_json
      FROM ${REVIEWS_TABLE} r
      LEFT JOIN ${DETAIL_TABLE} d ON d.review_id = r.review_id AND d.route_id = @route_id
      ORDER BY r.reviewed_at DESC, r.review_id DESC
    `);
  const row = result.recordset[0];
  if (!row) return { state: "none" };
  if (!row.detail_json) return { state: "route_missing" };
  const stored = JSON.parse(row.review_json) as StoredSummary;
  const detail = JSON.parse(row.detail_json) as RouteScheduleDetail;
  const known = new Set(checks.map((c) => c.id));
  return {
    state: "ready",
    reviewed_at: row.reviewed_at.toISOString(),
    confirmed_at: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    feed: stored.feed,
    route: { ...detail, checks: detail.checks.filter((c) => known.has(c.id)) },
    route_long_name: (await loadRouteLongNames(pool)).get(routeId) ?? null,
  };
}

/** Every route's stored timepoint segments from the latest review; empty before migration 145. */
export async function loadLatestRouteSegments(pool: sql.ConnectionPool): Promise<Map<string, RouteScheduleDetail["segments"]>> {
  if (!await tableReady(pool, REVIEWS_TABLE) || !await tableReady(pool, DETAIL_TABLE)) return new Map();
  const result = await pool.request().query<{ route_id: string; detail_json: string }>(`
    SELECT d.route_id, d.detail_json
    FROM ${DETAIL_TABLE} d
    WHERE d.review_id = (SELECT TOP 1 review_id FROM ${REVIEWS_TABLE} ORDER BY reviewed_at DESC, review_id DESC)
  `);
  return new Map(result.recordset.map((r) => [r.route_id, (JSON.parse(r.detail_json) as RouteScheduleDetail).segments]));
}
