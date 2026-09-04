import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid } from "../lib/validation";

// The only path back from review_status = 'needs_review'. detoursUpdate
// flags every material edit for OCC re-review; without this the flag was
// permanent. Clearing it is an audited act: the reason it was raised and
// any notes go into DetourWorkflowHistory as a manual_correction so the
// record shows who looked at the change and when.
app.http("detoursReviewComplete", {
  route: "detours/{id}/review-complete", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "id must be a GUID" } };
    let body: Record<string, unknown> = {};
    try { body = ((await request.json()) ?? {}) as Record<string, unknown>; } catch { /* empty body is fine */ }
    if (body.notes !== undefined && body.notes !== null && (typeof body.notes !== "string" || body.notes.length > 1000)) {
      return { status: 400, jsonBody: { error: "notes must be a string of at most 1000 characters if provided" } };
    }
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    try {
      const pool = await getPool();
      const schema = await pool.request().query<{ ready: number }>("SELECT CASE WHEN COL_LENGTH('dbo.Detours', 'review_status') IS NULL OR OBJECT_ID('dbo.DetourWorkflowHistory', 'U') IS NULL THEN 0 ELSE 1 END AS ready");
      if (schema.recordset[0]?.ready !== 1) return { status: 503, jsonBody: { error: "Re-review tracking is not configured" } };
      const actor = auth.principal.userDetails || "system";
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const current = (await new sql.Request(tx).input("id", sql.UniqueIdentifier, id)
          .query<{ review_status: string; review_reason: string | null; lifecycle_state: string | null }>("SELECT review_status, review_reason, lifecycle_state FROM Detours WHERE id=@id AND is_deleted=0")).recordset[0];
        if (!current) { await tx.rollback(); return { status: 404, jsonBody: { error: "Detour not found" } }; }
        if (current.review_status !== "needs_review") { await tx.rollback(); return { status: 409, jsonBody: { error: "Detour is not awaiting OCC re-review" } }; }
        await new sql.Request(tx).input("id", sql.UniqueIdentifier, id).input("actor", sql.NVarChar(200), actor)
          .query("UPDATE Detours SET review_status='current', review_reason=NULL, updated_by=@actor, updated_at=SYSUTCDATETIME() WHERE id=@id");
        const detail = `OCC re-review completed${current.review_reason ? ` (raised: ${current.review_reason})` : ""}${notes ? `: ${notes}` : ""}`.slice(0, 1000);
        await new sql.Request(tx).input("detour_id", sql.UniqueIdentifier, id).input("state", sql.NVarChar(30), current.lifecycle_state)
          .input("detail", sql.NVarChar(1000), detail).input("actor", sql.NVarChar(200), actor)
          .query("INSERT INTO DetourWorkflowHistory (detour_id, event_type, from_state, to_state, source, detail, changed_by) VALUES (@detour_id, 'manual_correction', @state, @state, 'manual', @detail, @actor)");
        await tx.commit();
        return { status: 200, jsonBody: { id, review_status: "current", reviewed_by: actor } };
      } catch (err) { await tx.rollback(); throw err; }
    } catch (err) { context.error("POST detour review-complete failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
