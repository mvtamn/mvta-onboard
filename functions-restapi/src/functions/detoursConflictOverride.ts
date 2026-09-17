import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid } from "../lib/validation";
import { actorFrom, performDetourAct } from "../lib/detourWorkflow";
import { refusalResponse } from "../lib/detourWorkflowResponse";

// A Conflict override covers the conflicts known now; one that appears later
// makes the Detour's conflict status unresolved again.
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
      const actor = actorFrom(auth.principal);
      const outcome = await performDetourAct(await getPool(), id, { act: "override_conflict", reason }, actor);
      if (!outcome.ok) return refusalResponse(outcome.refusal);
      return { status: 200, jsonBody: { id, conflict_status: "overridden", conflict_override_reason: reason, conflict_override_by: actor.kind === "person" ? actor.name : null, conflicts: outcome.conflicts ?? [] } };
    } catch (err) { context.error("POST detour conflict-override failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
