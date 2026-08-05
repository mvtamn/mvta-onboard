// DELETE /detours/{id} - soft delete (is_deleted=1), never a hard delete,
// matching this repo's existing retract-not-delete convention
// (messagesRetract.ts). Publisher/Admin only.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, PUBLISH_ROLES } from "../lib/auth";
import { isGuid } from "../lib/validation";

app.http("detoursDelete", {
  route: "detours/{id}",
  methods: ["DELETE"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, PUBLISH_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const id = request.params.id;
    if (!isGuid(id)) {
      return { status: 400, jsonBody: { error: "id must be a GUID" } };
    }

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("id", sql.UniqueIdentifier, id);
      sqlRequest.input("updated_by", sql.NVarChar, authResult.principal.userDetails || "system");

      const result = await sqlRequest.query<{ id: string }>(`
        UPDATE Detours
        SET is_deleted = 1, updated_by = @updated_by, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.id
        WHERE id = @id AND is_deleted = 0
      `);

      if (result.recordset.length === 0) {
        return { status: 404, jsonBody: { error: "Detour not found" } };
      }
      return { status: 200, jsonBody: { id: result.recordset[0].id, is_deleted: true } };
    } catch (err) {
      context.error("DELETE /detours/{id} failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
