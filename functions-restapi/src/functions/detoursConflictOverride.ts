import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid } from "../lib/validation";
import { detourConflicts, loadDetourConflictScopes } from "../lib/detourConflicts";

// Records the reasoned authorisation to proceed despite the Detours this
// one currently conflicts with. The reason, the actor, and the conflicting
// ids go on the row (migration 090) and into DetourWorkflowHistory, so the
// audit keeps the warning alongside the decision.
app.http("detoursConflictOverride", {
  route: "detours/{id}/conflict-override", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return { status: 400, jsonBody: { error: "reason is required to override a conflict" } };
    if (reason.length > 1000) return { status: 400, jsonBody: { error: "reason must be at most 1000 characters" } };
    try {
      const pool = await getPool();
      const schema = await pool.request().query<{ ready: number }>("SELECT CASE WHEN COL_LENGTH('dbo.Detours', 'conflict_override_reason') IS NULL OR OBJECT_ID('dbo.DetourWorkflowHistory', 'U') IS NULL THEN 0 ELSE 1 END AS ready");
      if (schema.recordset[0]?.ready !== 1) return { status: 503, jsonBody: { error: "Conflict override tracking is not configured" } };
      const scopes = await loadDetourConflictScopes(pool);
      const subject = scopes.find((s) => s.id === id);
      if (!subject) return { status: 409, jsonBody: { error: "Detour was not found, is deleted, or is closed" } };
      const conflicts = detourConflicts(subject, scopes);
      if (conflicts.length === 0) return { status: 409, jsonBody: { error: "Detour has no current conflicts to override" } };
      const actor = auth.principal.userDetails || "system";
      const ids = conflicts.map((c) => c.id);
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx).input("id", sql.UniqueIdentifier, id).input("reason", sql.NVarChar(1000), reason).input("actor", sql.NVarChar(200), actor).input("ids", sql.NVarChar(sql.MAX), JSON.stringify(ids))
          .query("UPDATE Detours SET conflict_override_reason=@reason, conflict_override_by=@actor, conflict_override_at=SYSUTCDATETIME(), conflict_override_ids=@ids, updated_by=@actor, updated_at=SYSUTCDATETIME() WHERE id=@id AND is_deleted=0");
        const detail = `Conflict override: ${reason} (conflicts: ${conflicts.map((c) => c.label).join(", ")})`.slice(0, 1000);
        await new sql.Request(tx).input("detour_id", sql.UniqueIdentifier, id).input("state", sql.NVarChar(30), subject.status === "recorded" ? null : subject.status).input("detail", sql.NVarChar(1000), detail).input("actor", sql.NVarChar(200), actor)
          .query("INSERT INTO DetourWorkflowHistory (detour_id, event_type, from_state, to_state, source, detail, changed_by) VALUES (@detour_id, 'manual_correction', @state, @state, 'manual', @detail, @actor)");
        await tx.commit();
        return { status: 200, jsonBody: { id, conflict_status: "overridden", conflict_override_reason: reason, conflict_override_by: actor, conflicts } };
      } catch (err) { await tx.rollback(); throw err; }
    } catch (err) { context.error("POST detour conflict-override failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
