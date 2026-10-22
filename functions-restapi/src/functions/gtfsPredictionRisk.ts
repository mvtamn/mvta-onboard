// GET /gtfs-prediction-risk - any OnBoard role. The latest static sync's review
// of where the published schedule makes arrival predictions worse, per route.
// GET /gtfs-prediction-risk/routes/{routeId} - the evidence behind one route's
// flags and its scheduled minutes per timepoint segment by hour (migration 145).
// Schedule data only: no rider, driver or vehicle records.
// GET /gtfs-prediction-risk/history?from=&to= - one entry per distinct review,
// newest first, and what changed between two of them (by default the newest
// and the one before). Any OnBoard role: schedule data only.
// GET /gtfs-prediction-risk/observed-summary - every route's readings counted,
// with the one the ranked route list names (Schedule Review's "confirmed by
// Avail"). OTP data, so compliance-review.view, like /observed.
// GET /gtfs-prediction-risk/routes/{routeId}/observed - what Avail saw at the
// route's timepoints by hour over a window, beside the schedule. Reads OTP
// data, so it needs compliance-review.view like /otp-daily does.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireAccess, requireAnyOnBoardAccess } from "../lib/access/require";
import { getPool } from "../lib/db";
import { PREDICTION_RISK_CHECKS } from "../lib/scheduleReview";
import { compareReviews, latestReview, latestSegments, routeDetail } from "../lib/scheduleReview/store";
import { readings, summarizeObserved, summarizeRouteReadings } from "../lib/scheduleReview/observed";
import { loadObservedRows, loadObservedRowsByRoute, parseObservedDays, parseObservedDow } from "../lib/scheduleReview/observedStore";

app.http("gtfsPredictionRisk", {
  route: "gtfs-prediction-risk",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAnyOnBoardAccess(request);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      return { status: 200, jsonBody: { review: await latestReview(pool) } };
    } catch (error) {
      context.error("GET /gtfs-prediction-risk failed:", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("gtfsPredictionRiskRoute", {
  route: "gtfs-prediction-risk/routes/{routeId}",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAnyOnBoardAccess(request);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const routeId = request.params.routeId?.trim() ?? "";
    if (!routeId || routeId.length > 50) return { status: 400, jsonBody: { error: "Invalid route id" } };
    try {
      const pool = await getPool();
      const detail = await routeDetail(pool, routeId);
      if (detail.state === "none") return { status: 404, jsonBody: { error: "No schedule review has been kept yet." } };
      if (detail.state === "route_missing") {
        return { status: 404, jsonBody: { error: "The latest schedule review has no detail for this route. It is not in the feed." } };
      }
      return {
        status: 200,
        jsonBody: { reviewed_at: detail.reviewed_at, confirmed_at: detail.confirmed_at, feed: detail.feed, checks: PREDICTION_RISK_CHECKS, route: detail.route, route_long_name: detail.route_long_name },
      };
    } catch (error) {
      context.error("GET /gtfs-prediction-risk/routes failed:", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("gtfsPredictionRiskRouteObserved", {
  route: "gtfs-prediction-risk/routes/{routeId}/observed",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "compliance-review.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const routeId = request.params.routeId?.trim() ?? "";
    if (!routeId || routeId.length > 50) return { status: 400, jsonBody: { error: "Invalid route id" } };
    const days = parseObservedDays(request.query.get("days"));
    const dow = parseObservedDow(request.query.get("dow"));
    try {
      const pool = await getPool();
      const { rows, window } = await loadObservedRows(pool, routeId, days, dow);
      if (rows.length === 0) {
        return { status: 404, jsonBody: { error: `Avail's OTP daily feed has no rows for this route in the last ${days} ${dow === "weekday" ? "weekdays" : dow === "saturday" ? "Saturdays" : "Sundays"}.` } };
      }
      // The schedule's segments give the order and the readings; with no
      // review of the route the grid still shows, in Avail's order, with no readings.
      const detail = await routeDetail(pool, routeId);
      const segments = detail.state === "ready" ? detail.route.segments : [];
      return {
        status: 200,
        jsonBody: { ...summarizeObserved(rows, segments, window), schedule_available: detail.state === "ready" },
      };
    } catch (error) {
      context.error("GET /gtfs-prediction-risk/routes/{routeId}/observed failed:", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

function reviewIdParam(value: string | null): number | null | "invalid" {
  if (value === null || value === "") return null;
  return /^\d{1,9}$/.test(value) ? Number(value) : "invalid";
}

app.http("gtfsPredictionRiskHistory", {
  route: "gtfs-prediction-risk/history",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAnyOnBoardAccess(request);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const fromParam = reviewIdParam(request.query.get("from"));
    const toParam = reviewIdParam(request.query.get("to"));
    if (fromParam === "invalid" || toParam === "invalid") return { status: 400, jsonBody: { error: "from and to are review ids" } };
    try {
      const pool = await getPool();
      const comparison = await compareReviews(pool, { from: fromParam, to: toParam });
      if (comparison.state === "same_review") return { status: 400, jsonBody: { error: "Pick two different reviews to compare." } };
      if (comparison.state === "not_kept") return { status: 404, jsonBody: { error: "One of those reviews is no longer kept." } };
      return { status: 200, jsonBody: { history: comparison.history, diff: comparison.diff } };
    } catch (error) {
      context.error("GET /gtfs-prediction-risk/history failed:", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("gtfsPredictionRiskObservedSummary", {
  route: "gtfs-prediction-risk/observed-summary",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "compliance-review.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const days = parseObservedDays(request.query.get("days"));
    const dow = parseObservedDow(request.query.get("dow"));
    try {
      const pool = await getPool();
      const [{ byRoute, window }, segmentsByRoute] = await Promise.all([
        loadObservedRowsByRoute(pool, days, dow),
        latestSegments(pool),
      ]);
      const routes = [...segmentsByRoute.entries()].map(([routeId, segments]) => {
        const rows = byRoute.get(routeId) ?? [];
        return {
          route_id: routeId,
          measured: rows.length > 0,
          departures: rows.reduce((sum, r) => sum + r.total, 0),
          ...summarizeRouteReadings(readings(rows, segments)),
        };
      });
      return { status: 200, jsonBody: { window, schedule_available: segmentsByRoute.size > 0, routes } };
    } catch (error) {
      context.error("GET /gtfs-prediction-risk/observed-summary failed:", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
