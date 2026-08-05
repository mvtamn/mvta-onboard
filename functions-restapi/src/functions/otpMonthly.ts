// GET /otp-monthly - Avail OTP Monthly By Route/Stop/Day of Week compliance
// data, backing the OTP Compliance console module's Route Summary/Review
// Queue/Monthly Assessments pages. Any staff role, plus the dedicated
// OCC.Compliance role, can read; all writes come from otpMonthlyFeedPoll.ts.
// Accepts an optional ?month=YYYYMM query param (default: current month).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { serviceMonthOf } from "../lib/otpMonthlyFeed";

const OFFICIAL_OTP_THRESHOLD = 0.9; // Attachment G's 90% departure-adherence standard

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

interface OtpMonthlyRouteRollup {
  route_id: number;
  route_label: string | null;
  total: number;
  ontime: number;
  pct_ontime: number | null;
}

function resolveMonth(request: HttpRequest): string {
  const param = request.query.get("month");
  return param && /^\d{6}$/.test(param) ? param : serviceMonthOf(new Date());
}

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

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpMonthlyRouteStopDay', 'U') IS NULL
          THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: {
            stops: [],
            routes: [],
            diagnostics: {
              configured,
              table_ready: false,
              service_month: serviceMonth,
              record_count: 0,
              routes_below_90: 0,
            },
          },
        };
      }

      const req = pool.request();
      req.input("service_month", sql.Char(6), serviceMonth);
      const stopsResult = await req.query<OtpMonthlyStopRow>(`
        SELECT service_month, route_id, stop_id, day_of_week, stop_name, route_label,
               pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
               early, ontime, late, missed, actual_departures, total, updated_at
        FROM OtpMonthlyRouteStopDay
        WHERE service_month = @service_month
        ORDER BY route_id, stop_id, day_of_week
      `);

      const routesReq = pool.request();
      routesReq.input("service_month", sql.Char(6), serviceMonth);
      const routesResult = await routesReq.query<OtpMonthlyRouteRollup>(`
        SELECT route_id, MAX(route_label) AS route_label,
               SUM(ISNULL(total, 0)) AS total, SUM(ISNULL(ontime, 0)) AS ontime,
               CASE WHEN SUM(ISNULL(total, 0)) > 0
                 THEN CAST(SUM(ISNULL(ontime, 0)) AS FLOAT) / SUM(ISNULL(total, 0))
                 ELSE NULL END AS pct_ontime
        FROM OtpMonthlyRouteStopDay
        WHERE service_month = @service_month
        GROUP BY route_id
        ORDER BY route_id
      `);

      const routes = routesResult.recordset;
      const routesBelow90 = routes.filter(
        (r) => r.pct_ontime !== null && r.pct_ontime < OFFICIAL_OTP_THRESHOLD,
      ).length;

      return {
        status: 200,
        jsonBody: {
          stops: stopsResult.recordset,
          routes,
          diagnostics: {
            configured,
            table_ready: true,
            service_month: serviceMonth,
            record_count: stopsResult.recordset.length,
            routes_below_90: routesBelow90,
          },
        },
      };
    } catch (err) {
      context.error("GET /otp-monthly failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
