// GET /gtfs-prediction-risk - any OnBoard role. The latest static sync's review
// of where the published schedule makes arrival predictions worse, per route.
// GET /gtfs-prediction-risk/routes/{routeId} - the evidence behind one route's
// flags and its scheduled minutes per timepoint segment by hour (migration 145).
// Schedule data only: no rider, driver or vehicle records.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireAnyOnBoardAccess } from "../lib/access/require";
import { getPool } from "../lib/db";
import { PREDICTION_RISK_CHECKS } from "../lib/scheduleReview";
import { loadLatestPredictionRiskReview, loadRouteScheduleDetail } from "../lib/scheduleReview/store";

app.http("gtfsPredictionRisk", {
  route: "gtfs-prediction-risk",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAnyOnBoardAccess(request);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      const latest = await loadLatestPredictionRiskReview(pool, PREDICTION_RISK_CHECKS);
      if (latest.state === "migration_missing") {
        return { status: 503, jsonBody: { error: "Run sql/migration-143-gtfs-prediction-risk-reviews.sql to keep the schedule's prediction-risk review." } };
      }
      return { status: 200, jsonBody: { review: latest.state === "ready" ? latest.review : null } };
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
      const detail = await loadRouteScheduleDetail(pool, routeId, PREDICTION_RISK_CHECKS);
      if (detail.state === "migration_missing") {
        return { status: 503, jsonBody: { error: "Run sql/migration-145-schedule-review-route-detail.sql to keep the evidence behind the schedule review." } };
      }
      if (detail.state === "none") return { status: 404, jsonBody: { error: "No schedule review has been kept yet." } };
      if (detail.state === "route_missing") {
        return { status: 404, jsonBody: { error: "The latest schedule review has no detail for this route. It is not in the feed, or the review predates migration 145 and the next static sync will keep it." } };
      }
      return {
        status: 200,
        jsonBody: { reviewed_at: detail.reviewed_at, confirmed_at: detail.confirmed_at, feed: detail.feed, checks: PREDICTION_RISK_CHECKS, route: detail.route },
      };
    } catch (error) {
      context.error("GET /gtfs-prediction-risk/routes failed:", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
