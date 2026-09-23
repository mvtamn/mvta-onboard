// Taking a missed-trip detector out of Shadow detection, and putting it back.
//
//   GET  /missed-trip-detector-promotions  - compliance-review.view
//   POST /missed-trip-detector-promotions  - service-configuration.edit
//
// The decision itself - the precision bar, the evidence, whether anything
// actually changes - belongs to the missed-trip case module (promotion.ts).
// This is transport: it reads the history, asks the module, and reports what
// the module said.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import {
  detectorStandings,
  ignoredDetectorNames,
  promotionWindows,
  readDetectorPromotions,
  recordDetectorPromotion,
  type PromotionRequest,
} from "../lib/missedTripCase";

// A service date is an agency day, so "does this count today" is asked in
// Central time - a UTC date would answer for tomorrow from 7pm on.
const serviceDateToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now).replaceAll("-", "");

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
