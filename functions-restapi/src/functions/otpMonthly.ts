// GET /otp-monthly - Avail OTP Monthly By Route/Stop/Day of Week compliance
// data, backing the OTP Compliance console module's Route Summary/Review
// Queue/Monthly Assessments pages. Any staff role, plus the dedicated
// OCC.Compliance role, can read; all writes come from otpMonthlyFeedPoll.ts.
// Accepts an optional ?month=YYYYMM query param (default: current month).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { serviceMonthOf } from "../lib/otpMonthlyFeed";
import { measureOtpMonth } from "../lib/otpMonth";

interface OtpMonthlyStopRow {
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  stop_name: string | null;
  route_label: string | null;
  pct_early: number | null;
  pct_ontime: number | null;
  pct_late: number | null;
  pct_not_ontime: number | null;
  pct_missed: number | null;
  early: number | null;
  ontime: number | null;
  late: number | null;
  missed: number | null;
  actual_departures: number | null;
  total: number | null;
  updated_at: Date;
}

function resolveMonth(request: HttpRequest): string {
  const param = request.query.get("month");
  return param && /^\d{6}$/.test(param) ? param : serviceMonthOf(new Date());
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
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const serviceMonth = resolveMonth(request);
    const configured = Boolean(
      process.env.AVAIL_OTP_MONTHLY_URL?.trim() && process.env.AVAIL_AVL_REPORTS_API_KEY?.trim(),
    );

    try {
      const pool = await getPool();
      const measurement = await measureOtpMonth(pool, serviceMonth);
      const stops = measurement.feed_ready
        ? (await pool.request().input("service_month", sql.Char(6), serviceMonth).query<OtpMonthlyStopRow>(`
            SELECT service_month, route_id, stop_id, day_of_week, stop_name, route_label,
                   pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
                   early, ontime, late, missed, actual_departures, total, updated_at
            FROM OtpMonthlyRouteStopDay
            WHERE service_month = @service_month
            ORDER BY route_id, stop_id, day_of_week
          `)).recordset
        : [];

      return {
        status: 200,
        jsonBody: {
          stops,
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
          diagnostics: {
            configured,
            table_ready: measurement.feed_ready,
            service_month: serviceMonth,
            record_count: stops.length,
            routes_below_target: measurement.routes_below_target,
            target: measurement.target,
            target_source: measurement.target_source,
            weather_days_recorded: measurement.weather_days_recorded,
          },
        },
      };
    } catch (err) {
      context.error("GET /otp-monthly failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
