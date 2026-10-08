// The single admin-configurable OTP Compliance setting today: the Early/Late
// Bias Threshold that decides which stop/route/day rows become Flagged Stops.
// lib/otpSettings.ts reads it for GET /otp-monthly, which applies it; this
// handler is the console's read and the Threshold Tuner's write. Same
// single-row-settings-table pattern as ExpirationDefaults, just one row
// instead of one per category. The tuner previews a trial threshold through
// GET /otp-monthly?threshold=, so previewing still needs no write permission.
//
//   GET /otp-settings   - compliance-review.view
//   PATCH /otp-settings - service-configuration.edit
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { validateOtpSettings } from "../lib/validation";

interface OtpSettingsRow {
  early_late_bias_threshold: number;
  updated_by: string | null;
  updated_at: Date;
}

const DEFAULT_THRESHOLD = 0.15;

app.http("otpSettingsGet", {
  route: "otp-settings",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.OtpSettings', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return {
          status: 200,
          jsonBody: { early_late_bias_threshold: DEFAULT_THRESHOLD, updated_by: null, updated_at: null },
        };
      }
      const result = await pool.request().query<OtpSettingsRow>(`
        SELECT early_late_bias_threshold, updated_by, updated_at FROM OtpSettings WHERE id = 1
      `);
      return { status: 200, jsonBody: result.recordset[0] ?? { early_late_bias_threshold: DEFAULT_THRESHOLD, updated_by: null, updated_at: null } };
    } catch (err) {
      context.error("GET /otp-settings failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpSettingsUpdate", {
  route: "otp-settings",
  methods: ["PATCH"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "service-configuration.edit");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateOtpSettings(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as { early_late_bias_threshold: number };

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("threshold", sql.Float, body.early_late_bias_threshold);
      sqlRequest.input("updated_by", sql.NVarChar, authResult.principal.userDetails || "system");

      const result = await sqlRequest.query<OtpSettingsRow>(`
        UPDATE OtpSettings
        SET early_late_bias_threshold = @threshold, updated_by = @updated_by, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.early_late_bias_threshold, INSERTED.updated_by, INSERTED.updated_at
        WHERE id = 1
      `);
      if (result.recordset.length === 0) {
        return { status: 404, jsonBody: { error: "OTP settings row not found - has migration-018 been run?" } };
      }
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("PATCH /otp-settings failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
