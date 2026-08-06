// GET /otp-daily - sub-monthly OTP trending data (OtpDailyRouteStopHour),
// added per OTP-Feed-Evaluation-and-Recommendation (3).md's live-data
// investigation update. Not the official Attachment G compliance number -
// see otpMonthly.ts for that. Accepts optional ?start=YYYYMMDD&end=YYYYMMDD
// (defaults to the trailing 7 days) and an optional ?route_id= filter. No
// UI consumes this yet - built for future trending views once this feed's
// still-unconfirmed field mapping (see otpDailyFeed.ts) has been checked
// against a real response.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

interface OtpDailyRow {
  calendar_date: string;
  hour_of_day: number;
  route_id: number;
  stop_id: number;
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
  latitude: number | null;
  longitude: number | null;
  direction: string | null;
  updated_at: Date;
}

function calendarDateNDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function calendarDateToday(): string {
  return calendarDateNDaysAgo(0);
}

app.http("otpDailyList", {
  route: "otp-daily",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const startParam = request.query.get("start");
    const endParam = request.query.get("end");
    const routeIdParam = request.query.get("route_id");
    const start = startParam && /^\d{8}$/.test(startParam) ? startParam : calendarDateNDaysAgo(7);
    const end = endParam && /^\d{8}$/.test(endParam) ? endParam : calendarDateToday();
    const routeId = routeIdParam ? parseInt(routeIdParam, 10) : null;

    try {
      const pool = await getPool();

      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpDailyRouteStopHour', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { rows: [], diagnostics: { table_ready: false, start, end, record_count: 0 } } };
      }

      const req = pool.request();
      req.input("start", sql.Char(8), start);
      req.input("end", sql.Char(8), end);
      let query = `
        SELECT calendar_date, hour_of_day, route_id, stop_id, stop_name, route_label,
               pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
               early, ontime, late, missed, actual_departures, total,
               latitude, longitude, direction, updated_at
        FROM OtpDailyRouteStopHour
        WHERE calendar_date BETWEEN @start AND @end
      `;
      if (routeId !== null && Number.isInteger(routeId)) {
        req.input("route_id", sql.Int, routeId);
        query += " AND route_id = @route_id";
      }
      query += " ORDER BY calendar_date, hour_of_day, route_id, stop_id";

      const result = await req.query<OtpDailyRow>(query);

      return {
        status: 200,
        jsonBody: {
          rows: result.recordset,
          diagnostics: { table_ready: true, start, end, record_count: result.recordset.length },
        },
      };
    } catch (err) {
      context.error("GET /otp-daily failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
