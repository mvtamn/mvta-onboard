// Expiration defaults admin (architecture doc Section 9):
//   GET  /admin/expiration-defaults              - any staff role
//   PATCH /admin/expiration-defaults/{category}  - Admin only
// The ExpirationDefaults table is seeded by phase1-schema.sql; these defaults
// drive expires_at when a message is created without an explicit expiration.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES, ADMIN_ROLES } from "../lib/auth";
import { validateExpirationDefault, VALID_CATEGORIES } from "../lib/validation";

app.http("expirationDefaultsList", {
  route: "admin/expiration-defaults",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, STAFF_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const result = await pool.request().query<{
        category: string;
        default_ttl_minutes: number;
        updated_by: string | null;
        updated_at: Date;
      }>(`SELECT category, default_ttl_minutes, updated_by, updated_at FROM ExpirationDefaults ORDER BY category`);
      return { status: 200, jsonBody: { defaults: result.recordset } };
    } catch (err) {
      context.error("GET /admin/expiration-defaults failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("expirationDefaultsUpdate", {
  route: "admin/expiration-defaults/{category}",
  methods: ["PATCH"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, ADMIN_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const category = request.params.category;
    if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
      return { status: 400, jsonBody: { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateExpirationDefault(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as { default_ttl_minutes: number };

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("category", sql.NVarChar, category);
      sqlRequest.input("ttl", sql.Int, body.default_ttl_minutes);
      sqlRequest.input("updated_by", sql.NVarChar, authResult.principal.userDetails ?? "onboard-console");

      const result = await sqlRequest.query<{
        category: string;
        default_ttl_minutes: number;
        updated_at: Date;
      }>(`
        UPDATE ExpirationDefaults
        SET default_ttl_minutes = @ttl, updated_by = @updated_by, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.category, INSERTED.default_ttl_minutes, INSERTED.updated_at
        WHERE category = @category
      `);

      if (result.recordset.length === 0) {
        return { status: 404, jsonBody: { error: "Category not found" } };
      }
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("PATCH /admin/expiration-defaults failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
