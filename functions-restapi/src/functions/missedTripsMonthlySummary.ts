// GET /missed-trips-monthly-summary - the aggregate view behind Missed
// Trips' Monthly Assessments page. Which cases are findings, and what each one
// counts as, is the Missed-trip case module's business
// (lib/missedTripCase/reads.ts) - the same classification GET /missed-trips
// reads, so the two pages can never disagree about what "confirmed" means.
//
// The console pivots this into a per-route/month table client-side rather than
// the backend pre-shaping one specific table layout, same "return the facts,
// let the UI decide presentation" approach as otpMonthlyTrend.ts.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { readMissedTripMonthlySummary } from "../lib/missedTripCase";

app.http("missedTripsMonthlySummary", {
  route: "missed-trips-monthly-summary",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const read = await readMissedTripMonthlySummary(await getPool());
      return { status: 200, jsonBody: { summary: read.ready ? read.summary : [] } };
    } catch (err) {
      context.error("GET /missed-trips-monthly-summary failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
