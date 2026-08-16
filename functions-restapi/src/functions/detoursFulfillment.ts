import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid, validateDetourFulfillmentChange } from "../lib/validation";

app.http("detoursFulfillment", {
  route: "detours/{id}/fulfillment",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validateDetourFulfillmentChange(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    if (body.fulfillment_mode !== "fixed_route_manual") {
      return { status: 409, jsonBody: { error: "Only fixed-route manual fallback is supported after an Avail conflict" } };
    }
    const changedBy = auth.principal.userDetails || "system";
    const reason = (body.reason as string).trim();
    let tx: sql.Transaction | undefined;
    try {
      const pool = await getPool();
      const currentReq = pool.request();
      currentReq.input("id", sql.UniqueIdentifier, id);
      const currentResult = await currentReq.query<{ fulfillment_mode: string; lifecycle_state: string }>(
        "SELECT fulfillment_mode, lifecycle_state FROM Detours WHERE id = @id AND is_deleted = 0",
      );
      const current = currentResult.recordset[0];
      if (!current) return { status: 404, jsonBody: { error: "Detour not found" } };
      if (current.fulfillment_mode !== "avail" || current.lifecycle_state !== "fulfillment_failed") {
        return { status: 409, jsonBody: { error: "A manual fallback is available only after an Avail conflict" } };
      }
      tx = new sql.Transaction(pool);
      await tx.begin();
      const update = new sql.Request(tx);
      update.input("id", sql.UniqueIdentifier, id);
      update.input("reason", sql.NVarChar(1000), reason);
      update.input("changed_by", sql.NVarChar(200), changedBy);
      await update.query(`UPDATE Detours SET fulfillment_mode = 'fixed_route_manual', lifecycle_state = 'fulfilled', fulfillment_change_reason = @reason, workflow_updated_by = @changed_by, workflow_updated_at = SYSUTCDATETIME(), updated_by = @changed_by, updated_at = SYSUTCDATETIME() WHERE id = @id AND is_deleted = 0`);
      const history = new sql.Request(tx);
      history.input("detour_id", sql.UniqueIdentifier, id);
      history.input("detail", sql.NVarChar(1000), reason);
      history.input("changed_by", sql.NVarChar(200), changedBy);
      await history.query(`INSERT INTO DetourWorkflowHistory (detour_id, event_type, from_state, to_state, source, detail, changed_by) VALUES (@detour_id, 'manual_correction', 'fulfillment_failed', 'fulfilled', 'manual', @detail, @changed_by)`);
      await tx.commit();
      return { status: 200, jsonBody: { id, fulfillment_mode: "fixed_route_manual", lifecycle_state: "fulfilled", readiness: "ready_for_manual_operations" } };
    } catch (err) {
      try { await tx?.rollback(); } catch { /* already ended */ }
      context.error("POST /detours/{id}/fulfillment failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
