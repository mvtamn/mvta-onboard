// Where the static sync keeps each prediction-risk review (migration 143), and
// how Integrations & Data Health reads the latest one back.
import { sql } from "./db";
import type { PredictionRiskReview } from "./gtfsPredictionRisk";

export interface StoredPredictionRiskReview extends PredictionRiskReview {
  reviewed_at: string;
}

async function tableReady(pool: sql.ConnectionPool): Promise<boolean> {
  const result = await pool.request().query<{ ready: number }>(
    "SELECT CASE WHEN OBJECT_ID('dbo.GtfsPredictionRiskReviews', 'U') IS NULL THEN 0 ELSE 1 END AS ready",
  );
  return result.recordset[0]?.ready === 1;
}

/** false when migration 143 has not been applied, so nothing was stored. */
export async function savePredictionRiskReview(pool: sql.ConnectionPool, review: PredictionRiskReview): Promise<boolean> {
  if (!await tableReady(pool)) return false;
  await pool.request()
    .input("feed_version", sql.NVarChar(100), review.feed.version)
    .input("route_count", sql.Int, review.routes.length)
    .input("flagged_route_count", sql.Int, review.routes.filter((r) => r.flag_count > 0).length)
    .input("review_json", sql.NVarChar(sql.MAX), JSON.stringify({ feed: review.feed, routes: review.routes }))
    .query(`
      INSERT INTO GtfsPredictionRiskReviews (feed_version, route_count, flagged_route_count, review_json)
      VALUES (@feed_version, @route_count, @flagged_route_count, @review_json)
    `);
  return true;
}

export type LatestPredictionRiskReview =
  | { state: "ready"; review: StoredPredictionRiskReview }
  | { state: "none" }
  | { state: "migration_missing" };

// The check definitions are not stored with the row: they are read from the
// code, so a review always describes its checks in today's words. A stored
// result for a check that no longer exists is dropped rather than shown with
// no explanation.
export async function loadLatestPredictionRiskReview(
  pool: sql.ConnectionPool,
  checks: PredictionRiskReview["checks"],
): Promise<LatestPredictionRiskReview> {
  if (!await tableReady(pool)) return { state: "migration_missing" };
  const result = await pool.request().query<{ reviewed_at: Date; review_json: string }>(`
    SELECT TOP 1 reviewed_at, review_json
    FROM GtfsPredictionRiskReviews
    ORDER BY reviewed_at DESC, review_id DESC
  `);
  const row = result.recordset[0];
  if (!row) return { state: "none" };
  const stored = JSON.parse(row.review_json) as Pick<PredictionRiskReview, "feed" | "routes">;
  const known = new Set(checks.map((c) => c.id));
  return {
    state: "ready",
    review: {
      reviewed_at: row.reviewed_at.toISOString(),
      feed: stored.feed,
      checks,
      routes: stored.routes.map((route) => ({ ...route, checks: route.checks.filter((c) => known.has(c.id)) })),
    },
  };
}
