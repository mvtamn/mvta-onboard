// GET /otp-audit-stream - the real Audit Stream, built the same way the
// console's top-level Audit Log (adminMessages.ts) is: by querying the
// records themselves rather than maintaining a separate generic log table.
// Merges OtpStopExclusions and OtpDateExclusions into one sorted timeline.
// Any staff role, plus OCC.Compliance.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

interface AuditEntry {
  type: "stop_exclusion" | "date_exclusion";
  title: string;
  desc: string;
  timestamp: Date;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

app.http("otpAuditStreamList", {
  route: "otp-audit-stream",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const monthParam = request.query.get("month");
    const month = monthParam && /^\d{6}$/.test(monthParam) ? monthParam : null;
    const limitParam = Number(request.query.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

    try {
      const pool = await getPool();

      const stopTableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpStopExclusions', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      const dateTableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpDateExclusions', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);

      const entries: AuditEntry[] = [];

      if (stopTableCheck.recordset[0]?.table_exists === 1) {
        const req = pool.request();
        if (month) req.input("service_month", sql.Char(6), month);
        const stopResult = await req.query<{
          route_id: number;
          stop_id: number;
          day_of_week: string;
          status: string;
          reason_code: string | null;
          reviewed_by: string;
          reviewed_at: Date;
        }>(`
          SELECT route_id, stop_id, day_of_week, status, reason_code, reviewed_by, reviewed_at
          FROM OtpStopExclusions
          ${month ? "WHERE service_month = @service_month" : ""}
        `);
        for (const r of stopResult.recordset) {
          entries.push({
            type: "stop_exclusion",
            title: r.status === "approved" ? "Exclusion approved" : "Candidate rejected",
            desc: `Route ${r.route_id} · Stop ${r.stop_id} · ${r.day_of_week} · ${r.reason_code ?? "no reason given"} · by ${r.reviewed_by}`,
            timestamp: r.reviewed_at,
          });
        }
      }

      if (dateTableCheck.recordset[0]?.table_exists === 1) {
        const dateResult = await pool.request().query<{
          scope: string;
          route_id: number | null;
          service_date: string;
          reason_code: string;
          created_by: string;
          created_at: Date;
        }>(`
          SELECT scope, route_id, service_date, reason_code, created_by, created_at
          FROM OtpDateExclusions
          ORDER BY created_at DESC
        `);
        for (const r of dateResult.recordset) {
          entries.push({
            type: "date_exclusion",
            title: "Weather exclusion logged",
            desc: `${r.service_date} · ${r.scope === "Agency" ? "All routes" : `Route ${r.route_id}`} · ${r.reason_code} · by ${r.created_by}`,
            timestamp: r.created_at,
          });
        }
      }

      entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      return { status: 200, jsonBody: { entries: entries.slice(0, limit) } };
    } catch (err) {
      context.error("GET /otp-audit-stream failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
