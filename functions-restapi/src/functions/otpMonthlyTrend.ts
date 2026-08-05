// GET /otp-monthly-trend?months=6 - agency-wide OTP % per service month,
// backing the Dashboard's trend chart (previously a "Power BI" placeholder).
// No dollar/penalty figure - no Attachment G penalty formula exists in this
// repo to build one from; this is % only, per the owner's decision. Any
// staff role, plus OCC.Compliance.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

interface TrendRow {
  service_month: string;
  total: number;
  ontime: number;
  pct_ontime: number | null;
}

const DEFAULT_MONTHS = 6;
const MAX_MONTHS = 24;

app.http("otpMonthlyTrendList", {
  route: "otp-monthly-trend",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const monthsParam = Number(request.query.get("months"));
    const months = Number.isFinite(monthsParam) && monthsParam > 0 ? Math.min(monthsParam, MAX_MONTHS) : DEFAULT_MONTHS;

    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpMonthlyRouteStopDay', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { trend: [] } };
      }

      const req = pool.request();
      req.input("months", sql.Int, months);
      const result = await req.query<TrendRow>(`
        SELECT TOP (@months) service_month,
               SUM(ISNULL(total, 0)) AS total, SUM(ISNULL(ontime, 0)) AS ontime,
               CASE WHEN SUM(ISNULL(total, 0)) > 0
                 THEN CAST(SUM(ISNULL(ontime, 0)) AS FLOAT) / SUM(ISNULL(total, 0))
                 ELSE NULL END AS pct_ontime
        FROM OtpMonthlyRouteStopDay
        GROUP BY service_month
        ORDER BY service_month DESC
      `);
      // Oldest-first for a left-to-right trend chart.
      return { status: 200, jsonBody: { trend: result.recordset.reverse() } };
    } catch (err) {
      context.error("GET /otp-monthly-trend failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
