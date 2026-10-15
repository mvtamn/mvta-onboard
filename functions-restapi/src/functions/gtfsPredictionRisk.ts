// GET /gtfs-prediction-risk - any OnBoard role. The latest static sync's review
// of where the published schedule makes arrival predictions worse, per route.
// Schedule data only: no rider, driver or vehicle records.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireAnyOnBoardAccess } from "../lib/access/require";
import { getPool } from "../lib/db";
import { PREDICTION_RISK_CHECKS } from "../lib/gtfsPredictionRisk";
import { loadLatestPredictionRiskReview } from "../lib/gtfsPredictionRiskStore";

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
