// GET /otp-monthly - Avail OTP Monthly By Route/Stop/Day of Week compliance
// figures, backing the OTP Compliance console module's Route Summary/Review
// Queue/Monthly Assessments pages. It returns the month's measurement and its
// Flagged Stops, not the feed's raw stop rows. compliance-review.view can read;
// all writes come from otpMonthlyFeedPoll.ts.
// Accepts an optional ?month=YYYYMM query param (default: current month) and
// an optional ?threshold= override for the Flagged Stops the Review Queue
// works from (default: the stored Early/Late Bias Threshold).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { serviceMonthOf } from "../lib/otpMonthlyFeed";
import { measureOtpMonth } from "../lib/otpMonth";
import { readFlaggedStops } from "../lib/otpFlaggedStops";
import { readEarlyLateBiasThreshold } from "../lib/otpSettings";

function resolveMonth(request: HttpRequest): string {
  const param = request.query.get("month");
  return param && /^\d{6}$/.test(param) ? param : serviceMonthOf(new Date());
}

// An optional override of the Early/Late Bias Threshold, for the Threshold
// Tuner in Administration > OTP Compliance. It previews a trial threshold
// without owning a second copy of the flagging rule - which is the whole point
// of the rule living on the server (ADR 0034). Absent, the stored setting
// answers. `undefined` means "no override"; `null` means "malformed".
function resolveThresholdOverride(request: HttpRequest): number | null | undefined {
  const param = request.query.get("threshold");
  if (param === null || param.trim() === "") return undefined;
  const value = Number(param);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return null;
  return value;
}

// The stop rows the Review Queue works from, and the month's measurement.
//
// The figures - raw, excluded, assessable, per route and agency-wide, the
// target and where the target came from - are the OTP month measurement
// module's (lib/otpMonth), the same answer the assessment scores and the
// reporting view publishes. This handler used to roll the routes up itself
// with no exclusions and no route-category filter, and look the target up by
// effective date, so the console's "Official departure OTP" card counted raw
// routes against a target a finalized month might not have been judged by.
app.http("otpMonthlyList", {
  route: "otp-monthly",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const serviceMonth = resolveMonth(request);
    const thresholdOverride = resolveThresholdOverride(request);
    if (thresholdOverride === null) {
      return {
        status: 400,
        jsonBody: { error: "threshold must be a number greater than 0 and less than 1" },
      };
    }
    const configured = Boolean(
      process.env.AVAIL_OTP_MONTHLY_URL?.trim() && process.env.AVAIL_AVL_REPORTS_API_KEY?.trim(),
    );

    try {
      const pool = await getPool();
      const measurement = await measureOtpMonth(pool, serviceMonth);
      // How many stop/day rows the feed holds for the month. The whole table
      // used to be returned so the browser could work out its own Review
      // Queue; now only the count travels, for the banner that reports it.
      const recordCount = measurement.feed_ready
        ? (await pool.request().input("service_month", sql.Char(6), serviceMonth).query<{ record_count: number }>(`
            SELECT COUNT(*) AS record_count
            FROM OtpMonthlyRouteStopDay
            WHERE service_month = @service_month
          `)).recordset[0]?.record_count ?? 0
        : 0;

      // Which stops the Review Queue asks a reviewer to look at. A sibling of
      // the measurement, never part of it: the measurement is the contractual
      // figure, and the threshold behind this list is a knob an administrator
      // can move (ADR 0034).
      const threshold = thresholdOverride ?? (await readEarlyLateBiasThreshold(pool));
      const flagged = measurement.feed_ready ? await readFlaggedStops(pool, serviceMonth, threshold) : [];

      return {
        status: 200,
        jsonBody: {
          // Kept for readers that predate the measurement: the same routes,
          // with the assessable figure as pct_ontime rather than the raw one.
          routes: measurement.routes.map((route) => ({
            route_id: route.route_id,
            route_label: route.route_label,
            total: route.assessable.departures,
            ontime: route.assessable.ontime,
            pct_ontime: route.assessable.pct,
          })),
          measurement,
          flagged,
          diagnostics: {
            configured,
            table_ready: measurement.feed_ready,
            service_month: serviceMonth,
            record_count: recordCount,
            routes_below_target: measurement.routes_below_target,
            target: measurement.target,
            target_source: measurement.target_source,
            weather_days_recorded: measurement.weather_days_recorded,
            // The threshold `flagged` was built at, so a reader can say which
            // one it is looking at without asking /otp-settings as well.
            flagged_threshold: threshold,
            flagged_count: flagged.length,
          },
        },
      };
    } catch (err) {
      context.error("GET /otp-monthly failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
