import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid, validateAvailEntryConfirmation } from "../lib/validation";

type AvailEntryResult = "entered" | "conflict" | "not_entered";

app.http("detoursAvailEntry", {
  route: "detours/{id}/avail-entry",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateAvailEntryConfirmation(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };

    const result = body.result as AvailEntryResult;
    const changedBy = auth.principal.userDetails || "system";
    try {
      const pool = await getPool();
      const schema = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN COL_LENGTH('dbo.Detours', 'avail_entry_result') IS NOT NULL
                         AND COL_LENGTH('dbo.Detours', 'avail_entry_confirmed_by') IS NOT NULL
                         AND COL_LENGTH('dbo.Detours', 'avail_entry_confirmed_at') IS NOT NULL
                    THEN 1 ELSE 0 END AS ready
      `);
      if (schema.recordset[0]?.ready !== 1) {
        return { status: 503, jsonBody: { error: "Avail entry tracking is not configured" } };
      }

      const currentReq = pool.request();
      currentReq.input("id", sql.UniqueIdentifier, id);
      const currentResult = await currentReq.query<{
        fulfillment_mode: string;
        lifecycle_state: string;
      }>(`SELECT fulfillment_mode, lifecycle_state FROM Detours WHERE id = @id AND is_deleted = 0`);
      const current = currentResult.recordset[0];
      if (!current) return { status: 404, jsonBody: { error: "Detour not found" } };
      if (current.fulfillment_mode !== "avail") {
        return { status: 409, jsonBody: { error: "Only Avail-backed Detours can record an Avail entry" } };
      }
      if (current.lifecycle_state !== "awaiting_fulfillment" && current.lifecycle_state !== "fulfillment_failed") {
        return { status: 409, jsonBody: { error: `Cannot record Avail entry from ${current.lifecycle_state}` } };
      }

      const nextState = result === "entered" ? "fulfilled" : result === "conflict" ? "fulfillment_failed" : "awaiting_fulfillment";
      const detail = typeof body.detail === "string" ? body.detail.trim() : null;
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const updateReq = new sql.Request(tx);
        updateReq.input("id", sql.UniqueIdentifier, id);
        updateReq.input("external_detour_id", sql.NVarChar(100), body.external_detour_id ?? null);
        updateReq.input("result", sql.NVarChar(20), result);
        updateReq.input("changed_by", sql.NVarChar(200), changedBy);
        updateReq.input("lifecycle_state", sql.NVarChar(30), nextState);
        await updateReq.query(`
          UPDATE Detours
          SET external_detour_id = COALESCE(@external_detour_id, external_detour_id),
              avail_entry_result = @result,
              avail_entry_confirmed_by = @changed_by,
              avail_entry_confirmed_at = SYSUTCDATETIME(),
              lifecycle_state = @lifecycle_state,
              workflow_updated_by = @changed_by,
              workflow_updated_at = SYSUTCDATETIME(),
              avail_build_confirmed_at = CASE WHEN @result = 'entered' THEN SYSUTCDATETIME() ELSE NULL END,
              updated_by = @changed_by,
              updated_at = SYSUTCDATETIME()
          WHERE id = @id AND is_deleted = 0
        `);

        const historyReq = new sql.Request(tx);
        historyReq.input("detour_id", sql.UniqueIdentifier, id);
        historyReq.input("from_state", sql.NVarChar(30), current.lifecycle_state);
        historyReq.input("to_state", sql.NVarChar(30), nextState);
        historyReq.input("source", sql.NVarChar(20), "manual");
        historyReq.input("detail", sql.NVarChar(1000), detail ?? `Human Avail entry result: ${result}`);
        historyReq.input("changed_by", sql.NVarChar(200), changedBy);
        await historyReq.query(`
          INSERT INTO DetourWorkflowHistory
            (detour_id, event_type, from_state, to_state, source, detail, changed_by)
          VALUES (@detour_id, 'fulfillment_confirmation', @from_state, @to_state,
                  @source, @detail, @changed_by)
        `);
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }

      return { status: 200, jsonBody: { id, result, lifecycle_state: nextState } };
    } catch (err) {
      context.error("POST /detours/{id}/avail-entry failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
