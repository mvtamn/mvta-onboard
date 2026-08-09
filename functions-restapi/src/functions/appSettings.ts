// Generic admin-managed application settings. This first consumer is Event
// Monitoring's AVL polling interval.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, ADMIN_ROLES } from "../lib/auth";

interface AppSettingRow {
  module: string;
  setting_key: string;
  setting_value: string;
  value_type: "int" | "string" | "bool" | "decimal";
  min_value: string | null;
  max_value: string | null;
  description: string | null;
  updated_by: string | null;
  updated_at: Date;
}

app.http("appSettings", {
  route: "app-settings",
  methods: ["GET", "PATCH"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, ADMIN_ROLES);
    if (!authResult.authorized) return { status: authResult.status, jsonBody: { error: authResult.message } };

    const moduleName = request.query.get("module")?.trim();
    if (!moduleName) return { status: 400, jsonBody: { error: "module query parameter is required" } };

    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.AppSettings', 'U') IS NULL THEN 0 ELSE 1 END AS ready
      `);
      if (tableCheck.recordset[0]?.ready !== 1) {
        return { status: 503, jsonBody: { error: "Application settings are not ready - apply migration-032." } };
      }

      if (request.method === "GET") {
        const dbRequest = pool.request();
        dbRequest.input("module", sql.NVarChar, moduleName);
        const result = await dbRequest.query<AppSettingRow>(`
          SELECT module, setting_key, setting_value, value_type, min_value, max_value,
                 description, updated_by, updated_at
          FROM AppSettings WHERE module = @module ORDER BY setting_key
        `);
        return { status: 200, jsonBody: { settings: result.recordset } };
      }

      let raw: unknown;
      try { raw = await request.json(); } catch {
        return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
      }
      const body = raw as { setting_key?: unknown; setting_value?: unknown };
      if (typeof body.setting_key !== "string" || typeof body.setting_value !== "string") {
        return { status: 400, jsonBody: { error: "setting_key and setting_value are required strings" } };
      }

      const lookup = pool.request();
      lookup.input("module", sql.NVarChar, moduleName);
      lookup.input("key", sql.NVarChar, body.setting_key);
      const existing = await lookup.query<AppSettingRow>(`
        SELECT module, setting_key, setting_value, value_type, min_value, max_value,
               description, updated_by, updated_at
        FROM AppSettings WHERE module = @module AND setting_key = @key
      `);
      const setting = existing.recordset[0];
      if (!setting) return { status: 404, jsonBody: { error: "Setting not found" } };

      if (setting.value_type === "int") {
        const value = Number(body.setting_value);
        const min = setting.min_value === null ? null : Number(setting.min_value);
        const max = setting.max_value === null ? null : Number(setting.max_value);
        if (!Number.isInteger(value) || (min !== null && value < min) || (max !== null && value > max)) {
          return { status: 400, jsonBody: { error: `setting_value must be an integer between ${min ?? "-infinity"} and ${max ?? "infinity"}` } };
        }
      }

      const update = pool.request();
      update.input("module", sql.NVarChar, moduleName);
      update.input("key", sql.NVarChar, body.setting_key);
      update.input("value", sql.NVarChar, body.setting_value);
      update.input("actor", sql.NVarChar, authResult.principal.userDetails || "system");
      const result = await update.query<AppSettingRow>(`
        UPDATE AppSettings SET setting_value = @value, updated_by = @actor, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.module, INSERTED.setting_key, INSERTED.setting_value, INSERTED.value_type,
               INSERTED.min_value, INSERTED.max_value, INSERTED.description,
               INSERTED.updated_by, INSERTED.updated_at
        WHERE module = @module AND setting_key = @key
      `);
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error(`${request.method} /app-settings failed:`, err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
