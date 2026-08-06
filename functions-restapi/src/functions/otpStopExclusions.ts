// Persisted Review Queue decisions - a candidate (a stop/route/day-of-week
// row flagged for early/late bias, see otpMonthlyFeed.ts) has no row here
// until staff actually approve or reject it; a pending candidate is derived
// live from OtpMonthlyRouteStopDay and never written here. computeOfficialPct
// (Route Summary/Dashboard) treats an 'approved' row as excluded from the
// route's official OTP%. Re-reviewing the same stop/day upserts in place.
//
//   GET /otp-stop-exclusions?month=  - any staff role, plus OCC.Compliance
//   PUT /otp-stop-exclusions          - Publisher/Admin, plus OCC.Compliance
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES, PUBLISH_ROLES } from "../lib/auth";
import { validateStopExclusion } from "../lib/validation";
import { serviceMonthOf } from "../lib/otpMonthlyFeed";

interface StopExclusionRow {
  id: string;
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  status: "approved" | "rejected";
  reason_code: string | null;
  reviewed_by: string;
  reviewed_at: Date;
}

function resolveMonth(request: HttpRequest): string {
  const param = request.query.get("month");
  return param && /^\d{6}$/.test(param) ? param : serviceMonthOf(new Date());
}

app.http("otpStopExclusionsList", {
  route: "otp-stop-exclusions",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const serviceMonth = resolveMonth(request);

    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpStopExclusions', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { exclusions: [] } };
      }

      const req = pool.request();
      req.input("service_month", sql.Char(6), serviceMonth);
      const result = await req.query<StopExclusionRow>(`
        SELECT id, service_month, route_id, stop_id, day_of_week, status, reason_code,
               reviewed_by, reviewed_at
        FROM OtpStopExclusions
        WHERE service_month = @service_month
      `);
      return { status: 200, jsonBody: { exclusions: result.recordset } };
    } catch (err) {
      context.error("GET /otp-stop-exclusions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpStopExclusionsUpsert", {
  route: "otp-stop-exclusions",
  methods: ["PUT"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...PUBLISH_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateStopExclusion(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as {
      service_month: string;
      route_id: number;
      stop_id: number;
      day_of_week: string;
      status: "approved" | "rejected";
      reason_code?: string | null;
    };

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("service_month", sql.Char(6), body.service_month);
      sqlRequest.input("route_id", sql.Int, body.route_id);
      sqlRequest.input("stop_id", sql.Int, body.stop_id);
      // NVarChar(20), not (3) - migration-022: some real Avail day_of_week
      // values overflowed the original "Mon"/"Tue"-sized column, same bug
      // as OtpMonthlyRouteStopDay (migration-021).
      sqlRequest.input("day_of_week", sql.NVarChar(20), body.day_of_week);
      sqlRequest.input("status", sql.NVarChar(10), body.status);
      sqlRequest.input("reason_code", sql.NVarChar, body.reason_code ?? null);
      sqlRequest.input("reviewed_by", sql.NVarChar, authResult.principal.userDetails || "system");

      const result = await sqlRequest.query<StopExclusionRow>(`
        MERGE OtpStopExclusions WITH (HOLDLOCK) AS target
        USING (
          SELECT @service_month AS service_month, @route_id AS route_id,
                 @stop_id AS stop_id, @day_of_week AS day_of_week
        ) AS src
        ON target.service_month = src.service_month AND target.route_id = src.route_id
           AND target.stop_id = src.stop_id AND target.day_of_week = src.day_of_week
        WHEN MATCHED THEN
          UPDATE SET status = @status, reason_code = @reason_code,
            reviewed_by = @reviewed_by, reviewed_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (service_month, route_id, stop_id, day_of_week, status, reason_code, reviewed_by)
          VALUES (@service_month, @route_id, @stop_id, @day_of_week, @status, @reason_code, @reviewed_by)
        OUTPUT INSERTED.id, INSERTED.service_month, INSERTED.route_id, INSERTED.stop_id,
               INSERTED.day_of_week, INSERTED.status, INSERTED.reason_code,
               INSERTED.reviewed_by, INSERTED.reviewed_at;
      `);

      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("PUT /otp-stop-exclusions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
