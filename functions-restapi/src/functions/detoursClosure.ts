import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid } from "../lib/validation";

app.http("detoursClosure", {
  route: "detours/{id}/close", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    if (typeof body.reason !== "string" || !body.reason.trim()) return { status: 400, jsonBody: { error: "reason is required to close a detour" } };
    try {
      const pool = await getPool();
      const schema = await pool.request().query<{ ready: number }>("SELECT CASE WHEN COL_LENGTH('dbo.Detours', 'closure_reason') IS NULL THEN 0 ELSE 1 END AS ready");
      if (schema.recordset[0]?.ready !== 1) return { status: 503, jsonBody: { error: "Closure tracking is not configured" } };
      const req = pool.request().input("id", sql.UniqueIdentifier, id).input("reason", sql.NVarChar(1000), (body.reason as string).trim()).input("actor", sql.NVarChar(200), auth.principal.userDetails || "system");
      const result = await req.query("UPDATE Detours SET lifecycle_state='closed', closure_reason=@reason, closed_by=@actor, closed_at=SYSUTCDATETIME(), workflow_updated_by=@actor, workflow_updated_at=SYSUTCDATETIME(), updated_by=@actor, updated_at=SYSUTCDATETIME() WHERE id=@id AND is_deleted=0 AND lifecycle_state <> 'closed'; SELECT id,lifecycle_state,closure_reason,closed_by,closed_at FROM Detours WHERE id=@id");
      const sets = result.recordsets as Array<Array<Record<string, unknown>>>;
      if (!sets[1]?.[0]) return { status: 409, jsonBody: { error: "Detour was not found or is already closed" } };
      return { status: 200, jsonBody: sets[1][0] };
    } catch (err) { context.error("POST detour close failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
