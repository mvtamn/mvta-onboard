// The stored schedule review: where the static sync keeps each review and
// everything that reads one back - the latest review, one route's evidence,
// every route's segments, and the history with what changed between two
// reviews. One summary row in GtfsPredictionRiskReviews (migration 143) and
// one detail row per route in GtfsScheduleReviewRoutes (migration 145).
//
// Written on change, not on every sync. The verdict (the summary) decides
// whether a new review row is written; the evidence behind an unchanged
// verdict is refreshed in place, so new code that records more about a
// segment reaches the detail without adding a row to the history. The feed
// changes a few times a year and the sync runs daily, so reviewed_at means
// "first seen" and confirmed_at "last found the same".
//
// Every read decodes a stored row the same way (decodeSummary, decodeRoute).
// The check definitions are not stored with the row: they are today's code,
// so a review always describes its checks in today's words. A stored result
// for a check that no longer exists is dropped rather than shown with no
// explanation, and the route's counts are recounted without it.
//
// This module assumes both migrations are applied. A missing table is an
// error here, and the health page's schema check (lib/schemaDrift.ts) is the
// one place that says which migration to run.
import { sql } from "../db";
import { PREDICTION_RISK_CHECKS } from "./checks";
import { diffReviews, type ReviewDiff, type ReviewSnapshot } from "./diff";
import { withFlagCounts, type RankedRoute } from "./ranking";
import type {
  PredictionRiskFeedInfo,
  PredictionRiskReview,
  PredictionRiskRoute,
  RouteScheduleDetail,
  ScheduleReview,
} from "./types";

const REVIEWS_TABLE = "GtfsPredictionRiskReviews";
const DETAIL_TABLE = "GtfsScheduleReviewRoutes";
const LATEST_REVIEW_ID = `(SELECT TOP 1 review_id FROM ${REVIEWS_TABLE} ORDER BY reviewed_at DESC, review_id DESC)`;

export const HISTORY_LIMIT = 50;

export interface ServedPredictionRiskRoute extends RankedRoute {
  /** From GtfsRoutes; null when the table has no row or no long name for it. */
  route_long_name: string | null;
}

export interface StoredPredictionRiskReview extends Omit<PredictionRiskReview, "routes"> {
  reviewed_at: string;
  /** Last sync that found the same review; null until one has. */
  confirmed_at: string | null;
  routes: ServedPredictionRiskRoute[];
}

export type StoredRouteScheduleDetail =
  | {
      state: "ready";
      reviewed_at: string;
      confirmed_at: string | null;
      feed: PredictionRiskFeedInfo;
      route: RouteScheduleDetail & Pick<RankedRoute, "fixable_flag_count" | "structural_flag_count">;
      route_long_name: string | null;
    }
  /** The latest review has no detail for this route: it is not in the feed. */
  | { state: "route_missing" }
  | { state: "none" };

export interface ReviewHistoryEntry {
  review_id: number;
  first_seen_at: string;
  last_seen_at: string;
  feed_version: string | null;
  route_count: number;
  flagged_route_count: number;
}

export type ReviewComparison =
  /** diff is null when there is nothing to compare: fewer than two reviews kept. */
  | { state: "ready"; history: ReviewHistoryEntry[]; diff: ReviewDiff | null }
  | { state: "same_review" }
  /** One of the two asked-for reviews does not exist. */
  | { state: "not_kept" };

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
  | "detail_refreshed";

// --- Decoding a stored row --------------------------------------------------

const KNOWN_CHECKS = new Set<string>(PREDICTION_RISK_CHECKS.map((c) => c.id));
const CHECK_ORDER = PREDICTION_RISK_CHECKS.map((c) => c.id);

function current<R extends Pick<PredictionRiskRoute, "checks" | "flag_count">>(route: R): R {
  const checks = route.checks.filter((c) => KNOWN_CHECKS.has(c.id));
  return { ...route, checks, flag_count: checks.filter((c) => c.flagged).length };
}

function decodeSummary(reviewJson: string): { feed: PredictionRiskFeedInfo; routes: PredictionRiskRoute[] } {
  const stored = JSON.parse(reviewJson) as Pick<PredictionRiskReview, "feed" | "routes">;
  return { feed: stored.feed, routes: stored.routes.map(current) };
}

function decodeRoute(detailJson: string): Extract<StoredRouteScheduleDetail, { state: "ready" }>["route"] {
  const route = current(JSON.parse(detailJson) as RouteScheduleDetail);
  const [{ fixable_flag_count, structural_flag_count }] = withFlagCounts([route], PREDICTION_RISK_CHECKS);
  return { ...route, fixable_flag_count, structural_flag_count };
}

function summaryJson(review: ScheduleReview): string {
  return JSON.stringify({ feed: review.summary.feed, routes: review.summary.routes, distance: review.distance });
}

/** route_id -> route_long_name from the static sync's GtfsRoutes table. */
async function routeLongNames(pool: sql.ConnectionPool): Promise<Map<string, string>> {
  const result = await pool.request().query<{ route_id: string; route_long_name: string | null }>(
    "SELECT route_id, route_long_name FROM GtfsRoutes",
  );
  return new Map(result.recordset.filter((r) => r.route_long_name).map((r) => [r.route_id, r.route_long_name as string]));
}

// --- Writing ----------------------------------------------------------------

/** Whether the stored per-route detail differs from the review's. */
function detailChanged(stored: ReadonlyMap<string, string>, details: readonly RouteScheduleDetail[]): boolean {
  if (stored.size !== details.length) return true;
  return details.some((detail) => stored.get(detail.route_id) !== JSON.stringify(detail));
}

async function inTransaction(pool: sql.ConnectionPool, work: (tx: sql.Transaction) => Promise<void>): Promise<void> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await work(tx);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
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

export async function saveReview(pool: sql.ConnectionPool, review: ScheduleReview): Promise<SaveOutcome> {
  const json = summaryJson(review);
  const latest = await pool.request().query<{ review_id: number; review_json: string }>(
    `SELECT review_id, review_json FROM ${REVIEWS_TABLE} WHERE review_id = ${LATEST_REVIEW_ID}`,
  );
  const row = latest.recordset[0];

  if (row && row.review_json === json) {
    const storedDetail = await pool.request().input("review_id", sql.Int, row.review_id)
      .query<{ route_id: string; detail_json: string }>(`SELECT route_id, detail_json FROM ${DETAIL_TABLE} WHERE review_id = @review_id`);
    const stored = new Map(storedDetail.recordset.map((d) => [d.route_id, d.detail_json]));
    const confirm = `UPDATE ${REVIEWS_TABLE} SET confirmed_at = SYSUTCDATETIME() WHERE review_id = @review_id`;
    if (!detailChanged(stored, review.details)) {
      await pool.request().input("review_id", sql.Int, row.review_id).query(confirm);
      return "unchanged";
    }
    await inTransaction(pool, async (tx) => {
      await new sql.Request(tx).input("review_id", sql.Int, row.review_id)
        .query(`DELETE FROM ${DETAIL_TABLE} WHERE review_id = @review_id`);
      await writeDetail(tx, row.review_id, review.details);
      await new sql.Request(tx).input("review_id", sql.Int, row.review_id).query(confirm);
    });
    return "detail_refreshed";
  }

  await inTransaction(pool, async (tx) => {
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
    await writeDetail(tx, inserted.recordset[0].review_id, review.details);
  });
  return "stored";
}

// --- Reading ----------------------------------------------------------------

/** The newest review with every route's counts and long name; null before the first sync. */
export async function latestReview(pool: sql.ConnectionPool): Promise<StoredPredictionRiskReview | null> {
  const result = await pool.request().query<{ reviewed_at: Date; confirmed_at: Date | null; review_json: string }>(
    `SELECT reviewed_at, confirmed_at, review_json FROM ${REVIEWS_TABLE} WHERE review_id = ${LATEST_REVIEW_ID}`,
  );
  const row = result.recordset[0];
  if (!row) return null;
  const { feed, routes } = decodeSummary(row.review_json);
  const names = await routeLongNames(pool);
  return {
    reviewed_at: row.reviewed_at.toISOString(),
    confirmed_at: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    feed,
    checks: PREDICTION_RISK_CHECKS,
    routes: withFlagCounts(routes, PREDICTION_RISK_CHECKS).map((route) => ({ ...route, route_long_name: names.get(route.route_id) ?? null })),
  };
}

/** One route's checks with their evidence and its timepoint segments, from the newest review. */
export async function routeDetail(pool: sql.ConnectionPool, routeId: string): Promise<StoredRouteScheduleDetail> {
  const result = await pool.request().input("route_id", sql.NVarChar(50), routeId)
    .query<{ reviewed_at: Date; confirmed_at: Date | null; review_json: string; detail_json: string | null; route_long_name: string | null }>(`
      SELECT r.reviewed_at, r.confirmed_at, r.review_json, d.detail_json, g.route_long_name
      FROM ${REVIEWS_TABLE} r
      LEFT JOIN ${DETAIL_TABLE} d ON d.review_id = r.review_id AND d.route_id = @route_id
      LEFT JOIN GtfsRoutes g ON g.route_id = @route_id
      WHERE r.review_id = ${LATEST_REVIEW_ID}
    `);
  const row = result.recordset[0];
  if (!row) return { state: "none" };
  if (!row.detail_json) return { state: "route_missing" };
  return {
    state: "ready",
    reviewed_at: row.reviewed_at.toISOString(),
    confirmed_at: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    feed: decodeSummary(row.review_json).feed,
    route: decodeRoute(row.detail_json),
    route_long_name: row.route_long_name || null,
  };
}

/** Every route's stored timepoint segments from the newest review; empty before the first sync. */
export async function latestSegments(pool: sql.ConnectionPool): Promise<Map<string, RouteScheduleDetail["segments"]>> {
  const result = await pool.request().query<{ route_id: string; detail_json: string }>(
    `SELECT route_id, detail_json FROM ${DETAIL_TABLE} WHERE review_id = ${LATEST_REVIEW_ID}`,
  );
  return new Map(result.recordset.map((r) => [r.route_id, (JSON.parse(r.detail_json) as RouteScheduleDetail).segments]));
}

async function history(pool: sql.ConnectionPool): Promise<ReviewHistoryEntry[]> {
  const result = await pool.request().input("limit", sql.Int, HISTORY_LIMIT).query<{
    review_id: number; reviewed_at: Date; confirmed_at: Date | null; feed_version: string | null; route_count: number; flagged_route_count: number;
  }>(`
    SELECT TOP (@limit) review_id, reviewed_at, confirmed_at, feed_version, route_count, flagged_route_count
    FROM ${REVIEWS_TABLE}
    ORDER BY reviewed_at DESC, review_id DESC
  `);
  return result.recordset.map((r) => ({
    review_id: r.review_id,
    first_seen_at: r.reviewed_at.toISOString(),
    last_seen_at: (r.confirmed_at ?? r.reviewed_at).toISOString(),
    feed_version: r.feed_version,
    route_count: r.route_count,
    flagged_route_count: r.flagged_route_count,
  }));
}

async function snapshot(pool: sql.ConnectionPool, reviewId: number): Promise<ReviewSnapshot | null> {
  const result = await pool.request().input("review_id", sql.Int, reviewId)
    .query<{ review_id: number; reviewed_at: Date; review_json: string }>(
      `SELECT review_id, reviewed_at, review_json FROM ${REVIEWS_TABLE} WHERE review_id = @review_id`,
    );
  const row = result.recordset[0];
  if (!row) return null;
  return { review_id: row.review_id, reviewed_at: row.reviewed_at.toISOString(), ...decodeSummary(row.review_json) };
}

/**
 * The history (newest first) and what changed between two reviews. By default
 * the newest against the one before it; given only `to`, that review against
 * the one before it. Compared in time order whichever way round they were asked.
 */
export async function compareReviews(
  pool: sql.ConnectionPool,
  ids: { from?: number | null; to?: number | null } = {},
): Promise<ReviewComparison> {
  const entries = await history(pool);
  const toId = ids.to ?? entries[0]?.review_id ?? null;
  const toIndex = entries.findIndex((entry) => entry.review_id === toId);
  const fromId = ids.from ?? (toIndex === -1 ? null : entries[toIndex + 1]?.review_id ?? null);
  if (toId === null || fromId === null) return { state: "ready", history: entries, diff: null };
  if (fromId === toId) return { state: "same_review" };
  const [from, to] = await Promise.all([snapshot(pool, fromId), snapshot(pool, toId)]);
  if (!from || !to) return { state: "not_kept" };
  const [earlier, later] = from.reviewed_at <= to.reviewed_at ? [from, to] : [to, from];
  return { state: "ready", history: entries, diff: diffReviews(earlier, later, CHECK_ORDER) };
}
