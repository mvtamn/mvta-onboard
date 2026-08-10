import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid } from "../lib/validation";
import { canTransition, DETOUR_LIFECYCLE_STATES, type DetourLifecycleState, type DetourFulfillmentMode } from "../lib/detourWorkflow";

app.http("detoursWorkflow", {
  route: "detours/{id}/workflow",
  methods: ["PATCH"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: unknown;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const next = (body as Record<string, unknown>)?.lifecycle_state;
    if (!DETOUR_LIFECYCLE_STATES.includes(next as DetourLifecycleState)) {
      return { status: 400, jsonBody: { error: `lifecycle_state must be one of: ${DETOUR_LIFECYCLE_STATES.join(", ")}` } };
    }
    try {
      const pool = await getPool();
      const currentReq = pool.request();
      currentReq.input("id", sql.UniqueIdentifier, id);
      const currentResult = await currentReq.query<{ fulfillment_mode: DetourFulfillmentMode; lifecycle_state: DetourLifecycleState }>(
        "SELECT fulfillment_mode, lifecycle_state FROM Detours WHERE id = @id AND is_deleted = 0",
      );
      const current = currentResult.recordset[0];
      if (!current) return { status: 404, jsonBody: { error: "Detour not found" } };
      if (!canTransition(current.lifecycle_state, next as DetourLifecycleState, current.fulfillment_mode)) {
        return { status: 409, jsonBody: { error: `Cannot transition ${current.lifecycle_state} to ${next} for ${current.fulfillment_mode}` } };
      }
      const updateReq = pool.request();
      updateReq.input("id", sql.UniqueIdentifier, id);
      updateReq.input("lifecycle_state", sql.NVarChar(30), next);
      updateReq.input("updated_by", sql.NVarChar(200), auth.principal.userDetails || "system");
      const result = await updateReq.query(`
        UPDATE Detours
        SET lifecycle_state = @lifecycle_state,
            workflow_updated_by = @updated_by,
            workflow_updated_at = SYSUTCDATETIME(),
            avail_build_confirmed_at = CASE WHEN @lifecycle_state = 'built_in_avail'
              THEN SYSUTCDATETIME() ELSE avail_build_confirmed_at END,
            updated_by = @updated_by, updated_at = SYSUTCDATETIME()
        WHERE id = @id AND is_deleted = 0
      `);
      if (!result.rowsAffected[0]) return { status: 404, jsonBody: { error: "Detour not found" } };
      return { status: 200, jsonBody: { id, lifecycle_state: next } };
    } catch (err) {
      context.error("PATCH /detours/{id}/workflow failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
