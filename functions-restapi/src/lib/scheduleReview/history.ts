// The schedule review's history: one entry per distinct review, and the
// stored review behind an entry for diff.ts.
//
// Until migration 145 the sync inserted the same review every day, so dev
// holds a run of identical rows per feed (and per review version). A history
// of rows would be a list of the same thing; this folds each run of identical
// review_json into one entry, first seen to last seen. With 145 applied a new
// row is only written on change, and the fold is a no-op.
import { sql } from "../db";
import type { ReviewSnapshot } from "./diff";
import type { PredictionRiskReview } from "./types";

export interface ReviewHistoryEntry {
  /** The newest row of the run; any row of it holds the same review. */
  review_id: number;
  first_seen_at: string;
  last_seen_at: string;
  feed_version: string | null;
  route_count: number;
  flagged_route_count: number;
}

export const HISTORY_LIMIT = 50;

async function tableReady(pool: sql.ConnectionPool, table: string): Promise<boolean> {
  const result = await pool.request().query<{ ready: number }>(
    `SELECT CASE WHEN OBJECT_ID('dbo.${table}', 'U') IS NULL THEN 0 ELSE 1 END AS ready`,
  );
  return result.recordset[0]?.ready === 1;
}

/** null when migration 143 has not been applied. Newest first. */
export async function loadReviewHistory(pool: sql.ConnectionPool, limit = HISTORY_LIMIT): Promise<ReviewHistoryEntry[] | null> {
  if (!await tableReady(pool, "GtfsPredictionRiskReviews")) return null;
  // confirmed_at arrived with migration 145, the same migration as the detail table.
  const lastSeen = await tableReady(pool, "GtfsScheduleReviewRoutes")
    ? "ISNULL(confirmed_at, reviewed_at)"
    : "reviewed_at";
  const result = await pool.request().input("limit", sql.Int, limit).query<{
    review_id: number; first_seen_at: Date; last_seen_at: Date; feed_version: string | null; route_count: number; flagged_route_count: number;
  }>(`
    WITH rows AS (
      SELECT review_id, reviewed_at, ${lastSeen} AS seen_at, feed_version, route_count, flagged_route_count,
             HASHBYTES('SHA2_256', review_json) AS digest
      FROM GtfsPredictionRiskReviews
    ),
    marked AS (
      SELECT *, CASE WHEN digest = LAG(digest) OVER (ORDER BY reviewed_at, review_id) THEN 0 ELSE 1 END AS starts_run
      FROM rows
    ),
    runs AS (
      SELECT *, SUM(starts_run) OVER (ORDER BY reviewed_at, review_id ROWS UNBOUNDED PRECEDING) AS run_no
      FROM marked
    )
    SELECT TOP (@limit)
           MAX(review_id) AS review_id,
           MIN(reviewed_at) AS first_seen_at,
           MAX(seen_at) AS last_seen_at,
           MAX(feed_version) AS feed_version,
           MAX(route_count) AS route_count,
           MAX(flagged_route_count) AS flagged_route_count
    FROM runs
    GROUP BY run_no
    ORDER BY run_no DESC
  `);
  return result.recordset.map((r) => ({
    review_id: r.review_id,
    first_seen_at: r.first_seen_at.toISOString(),
    last_seen_at: r.last_seen_at.toISOString(),
    feed_version: r.feed_version,
    route_count: r.route_count,
    flagged_route_count: r.flagged_route_count,
  }));
}

export async function loadReviewSnapshot(pool: sql.ConnectionPool, reviewId: number): Promise<ReviewSnapshot | null> {
  const result = await pool.request().input("review_id", sql.Int, reviewId)
    .query<{ review_id: number; reviewed_at: Date; review_json: string }>(
      "SELECT review_id, reviewed_at, review_json FROM GtfsPredictionRiskReviews WHERE review_id = @review_id",
    );
  const row = result.recordset[0];
  if (!row) return null;
  const stored = JSON.parse(row.review_json) as Pick<PredictionRiskReview, "feed" | "routes">;
  return { review_id: row.review_id, reviewed_at: row.reviewed_at.toISOString(), feed: stored.feed, routes: stored.routes };
}
