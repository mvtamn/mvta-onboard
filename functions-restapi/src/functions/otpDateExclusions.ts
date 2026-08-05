// Persisted weather/emergency date exclusions - replaces the Weather page's
// former ephemeral list. Agency-wide or route-specific, with the tracker's
// three staff-visible flags (notified/acknowledged/status) preserved from
// the original design.
//
//   GET /otp-date-exclusions   - any staff role, plus OCC.Compliance
//   POST /otp-date-exclusions  - Publisher/Admin, plus OCC.Compliance
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES, PUBLISH_ROLES } from "../lib/auth";
import { validateDateExclusion } from "../lib/validation";

interface DateExclusionRow {
  id: string;
  scope: "Agency" | "Route";
  route_id: number | null;
  service_date: string;
  reason_code: string;
  notes: string | null;
  status: "Proposed" | "Approved";
  notified: boolean;
  notified_at: Date | null;
  acknowledged: boolean;
  created_by: string;
  created_at: Date;
}

app.http("otpDateExclusionsList", {
  route: "otp-date-exclusions",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpDateExclusions', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { exclusions: [] } };
      }

      const result = await pool.request().query<DateExclusionRow>(`
        SELECT id, scope, route_id, service_date, reason_code, notes, status,
               notified, notified_at, acknowledged, created_by, created_at
        FROM OtpDateExclusions
        ORDER BY service_date DESC
      `);
      return { status: 200, jsonBody: { exclusions: result.recordset } };
    } catch (err) {
      context.error("GET /otp-date-exclusions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpDateExclusionsCreate", {
  route: "otp-date-exclusions",
  methods: ["POST"],
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
    const errors = validateDateExclusion(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as {
      scope: "Agency" | "Route";
      route_id?: number | null;
      service_date: string;
      reason_code: string;
      notes?: string | null;
    };
    const createdBy = authResult.principal.userDetails || "system";

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("scope", sql.NVarChar(10), body.scope);
      sqlRequest.input("route_id", sql.Int, body.scope === "Route" ? body.route_id ?? null : null);
      sqlRequest.input("service_date", sql.Char(8), body.service_date);
      sqlRequest.input("reason_code", sql.NVarChar, body.reason_code);
      sqlRequest.input("notes", sql.NVarChar, body.notes ?? null);
      sqlRequest.input("created_by", sql.NVarChar, createdBy);

      const result = await sqlRequest.query<DateExclusionRow>(`
        INSERT INTO OtpDateExclusions (scope, route_id, service_date, reason_code, notes, created_by)
        OUTPUT INSERTED.id, INSERTED.scope, INSERTED.route_id, INSERTED.service_date,
               INSERTED.reason_code, INSERTED.notes, INSERTED.status, INSERTED.notified,
               INSERTED.notified_at, INSERTED.acknowledged, INSERTED.created_by, INSERTED.created_at
        VALUES (@scope, @route_id, @service_date, @reason_code, @notes, @created_by)
      `);

      return { status: 201, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("POST /otp-date-exclusions failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
