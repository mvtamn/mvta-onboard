// GET /otp-monthly-trend?months=6 - agency-wide OTP % per service month,
// backing the Dashboard's trend chart (previously a "Power BI" placeholder).
// No dollar/penalty figure - no Attachment G penalty formula exists in this
// repo to build one from; this is % only, per the owner's decision. Requires
// compliance-review.view.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { measureOtpTrend } from "../lib/otpMonth";

const DEFAULT_MONTHS = 6;
const MAX_MONTHS = 24;

app.http("otpMonthlyTrendList", {
  route: "otp-monthly-trend",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const monthsParam = Number(request.query.get("months"));
    const months = Number.isFinite(monthsParam) && monthsParam > 0 ? Math.min(monthsParam, MAX_MONTHS) : DEFAULT_MONTHS;

    try {
      const pool = await getPool();
      // The assessable figure, from the OTP month measurement module: the same
      // number the scorecard shows. The chart used to plot the raw agency
      // rollup, so the Dashboard and the assessment disagreed by whatever the
      // exclusions and non-fixed-route service came to.
      const measured = await measureOtpTrend(pool, months);
      return {
        status: 200,
        jsonBody: {
          trend: measured.map((month) => ({
            service_month: month.service_month,
            total: month.assessable.departures,
            ontime: month.assessable.ontime,
            pct_ontime: month.assessable.pct,
            raw_total: month.raw.departures,
            raw_ontime: month.raw.ontime,
            raw_pct_ontime: month.raw.pct,
          })),
        },
      };
    } catch (err) {
      context.error("GET /otp-monthly-trend failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
