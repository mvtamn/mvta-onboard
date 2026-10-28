// Taking a missed-trip detector out of Shadow detection, and putting it back.
//
//   GET  /missed-trip-detector-promotions  - compliance-review.view
//   POST /missed-trip-detector-promotions  - service-configuration.edit
//   GET  /missed-trip-detector-scorecard   - compliance-review.view
//        ?from=YYYYMMDD&to=YYYYMMDD&group=week|day
//
// The decision itself - the precision bar, the evidence, whether anything
// actually changes - belongs to the missed-trip case module (promotion.ts), and
// so does the scorecard it is measured on (scorecard.ts). This is transport: it
// reads, asks the module, and reports what the module said.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import {
  detectorStandings,
  ignoredDetectorNames,
  promotionWindows,
  readDetectorPromotions,
  readDetectorScorecard,
  recordDetectorPromotion,
  scorecardQuery,
  serviceDateToday,
  type PromotionRequest,
} from "../lib/missedTripCase";

app.http("missedTripDetectorPromotionsGet", {
  route: "missed-trip-detector-promotions",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const access = await requireAccess(request, "compliance-review.view");
    if (!access.authorized) return { status: access.status, jsonBody: { error: access.message } };
    try {
      const pool = await getPool();
      const history = await readDetectorPromotions(pool);
      const windows = promotionWindows(history);
      return {
        status: 200,
        jsonBody: {
          standings: detectorStandings(windows, serviceDateToday()),
          history,
          // Names in the history this build does not know: a typo, or a
          // detector retired since the decision. Either way it promotes
          // nothing, and saying so beats a decision that looks applied.
          ignored: ignoredDetectorNames(history),
        },
      };
    } catch (err) {
      context.error("GET /missed-trip-detector-promotions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("missedTripDetectorPromotionsRecord", {
  route: "missed-trip-detector-promotions",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const access = await requireAccess(request, "service-configuration.edit");
    if (!access.authorized) return { status: access.status, jsonBody: { error: access.message } };
    let body: PromotionRequest;
    try {
      body = (await request.json()) as PromotionRequest;
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    try {
      const pool = await getPool();
      const outcome = await recordDetectorPromotion(pool, body, access.principal.userDetails || "system");
      if (!outcome.ok) {
        return { status: 409, jsonBody: { error: outcome.refusal.sentence, code: outcome.refusal.code } };
      }
      return { status: 201, jsonBody: outcome.entry };
    } catch (err) {
      context.error("POST /missed-trip-detector-promotions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("missedTripDetectorScorecardGet", {
  route: "missed-trip-detector-scorecard",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const access = await requireAccess(request, "compliance-review.view");
    if (!access.authorized) return { status: access.status, jsonBody: { error: access.message } };
    try {
      const today = serviceDateToday();
      const query = scorecardQuery({
        from: request.query.get("from"),
        to: request.query.get("to"),
        group: request.query.get("group"),
      }, today);
      return { status: 200, jsonBody: await readDetectorScorecard(await getPool(), query, today) };
    } catch (err) {
      context.error("GET /missed-trip-detector-scorecard failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
