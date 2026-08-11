// GET /detours/{id}/workflow-history - append-only operational history for a
// Detour. The endpoint exposes decisions and source observations without
// conflating them with the current row state.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_READ_ROLES, requireRole } from "../lib/auth";
import { isGuid } from "../lib/validation";

app.http("detourWorkflowHistory", {
  route: "detours/{id}/workflow-history",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };

    try {
      const pool = await getPool();
      const ready = await pool.request().query<{ ready: number }>(
        "SELECT CASE WHEN OBJECT_ID('dbo.DetourWorkflowHistory', 'U') IS NULL THEN 0 ELSE 1 END AS ready",
      );
      if (ready.recordset[0]?.ready !== 1) return { status: 200, jsonBody: { history: [] } };

      const req = pool.request();
      req.input("detour_id", sql.UniqueIdentifier, id);
      const result = await req.query(`
        SELECT id, detour_id, event_type, from_state, to_state, source,
               detail, changed_by, changed_at
        FROM DetourWorkflowHistory
        WHERE detour_id = @detour_id
        ORDER BY changed_at DESC, id DESC
      `);
      return { status: 200, jsonBody: { history: result.recordset } };
    } catch (err) {
      context.error("GET /detours/{id}/workflow-history failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
